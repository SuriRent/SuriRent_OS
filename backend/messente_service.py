"""Company-scoped SMS and WhatsApp via Messente's Omnichannel REST API."""
import re
from urllib.parse import urlsplit

import httpx


class MessenteError(Exception):
    pass


MESSENTE_API = "https://api.messente.com/v1/omnimessage"
TEMPLATE_KINDS = ("receipt", "receipt_media", "reminder", "authentication")


def _validate_number(number: str, kind: str = "ontvanger") -> str:
    value = (number or "").strip().removeprefix("whatsapp:").strip()
    value = re.sub(r"[\s().-]", "", value)
    if not re.fullmatch(r"\+[1-9][0-9]{6,14}", value):
        raise MessenteError(f"Ongeldig {kind} nummer: gebruik een nummer met landcode, bijvoorbeeld +5971234567")
    return value


def _media_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise MessenteError("Ongeldige WhatsApp-afbeeldingslink.") from exc
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise MessenteError("De WhatsApp-afbeelding vereist een publiek bereikbare HTTPS-URL.")
    return value


def whatsapp_variables(name: str, company: str, amount: str, reference: str, link: str) -> dict:
    return {
        str(index): re.sub(r"\s+", " ", str(value or "")).strip()
        for index, value in enumerate((name, company, amount, reference, link), start=1)
    }


def _template(cfg: dict, kind: str, variables: dict | None) -> dict | None:
    if kind not in TEMPLATE_KINDS:
        raise MessenteError("Onbekende WhatsApp-template.")
    name = str(cfg.get(f"{kind}_template") or "").strip()
    if not name:
        if kind == "receipt_media":
            raise MessenteError("Bewaar eerst de naam van de WhatsApp-afbeeldingstemplate.")
        return None
    language = str(cfg.get("template_language") or "").strip()
    if not re.fullmatch(r"[a-z0-9_]{1,512}", name) or not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", language):
        raise MessenteError("Ongeldige WhatsApp-templatenaam of taalcode.")
    keys = ("1",) if kind == "authentication" else tuple(str(i) for i in range(1, 5 if kind == "receipt_media" else 6))
    if not variables or any(not isinstance(variables.get(key), str) or not variables[key].strip() for key in keys):
        raise MessenteError("De invulvelden voor de WhatsApp-template zijn niet volledig.")
    components = [{
        "type": "body",
        "parameters": [{"type": "text", "text": variables[key]} for key in keys],
    }]
    if kind == "receipt_media":
        image = _media_url((variables.get("5") or "").strip())
        components.insert(0, {"type": "header", "parameters": [{"type": "image", "image": {"link": image}}]})
    elif kind == "authentication":
        components.append({
            "type": "button", "sub_type": "url", "index": 0,
            "parameters": [{"type": "text", "text": variables["1"]}],
        })
    return {"name": name, "language": {"code": language}, "components": components}


async def _send(cfg: dict, channel: str, to: str, message: dict) -> dict:
    if not cfg.get("enabled"):
        raise MessenteError("Messente is niet ingeschakeld")
    username = (cfg.get("api_username") or "").strip()
    password = (cfg.get("api_password") or "").strip()
    if not username or not password:
        raise MessenteError("Messente API-gebruikersnaam of API-wachtwoord ontbreekt")
    sender = (cfg.get("whatsapp_from" if channel == "whatsapp" else "sms_from") or "").strip()
    if not sender:
        raise MessenteError(f"Messente {channel}-afzender ontbreekt")
    payload = {"to": _validate_number(to), "messages": [{"channel": channel, "sender": sender, **message}]}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(MESSENTE_API, json=payload, auth=(username, password))
    except (httpx.HTTPError, OSError) as exc:
        raise MessenteError("Messente netwerkfout; het bericht is niet bevestigd. Controleer de verzendstatus voordat u opnieuw probeert.") from exc
    try:
        result = response.json()
    except ValueError as exc:
        raise MessenteError(f"Messente gaf een ongeldig antwoord (HTTP {response.status_code}).") from exc
    if not isinstance(result, dict):
        raise MessenteError("Messente gaf een ongeldig antwoord.")
    if response.status_code >= 400 or result.get("errors"):
        errors = result.get("errors")
        details = "; ".join(
            f"{error.get('code', response.status_code)}: {error.get('detail') or error.get('title') or 'Onbekende fout'}"
            for error in errors if isinstance(error, dict)
        ) if isinstance(errors, list) else ""
        raise MessenteError(f"Messente fout ({response.status_code}): {details or 'Verzoek geweigerd'}")
    messages = result.get("messages")
    if not isinstance(result.get("omnimessage_id"), str) or not result["omnimessage_id"] or not isinstance(messages, list) or not any(
        isinstance(item, dict) and isinstance(item.get("message_id"), str) and item["message_id"]
        and item.get("channel") == channel for item in messages
    ):
        raise MessenteError("Messente heeft de verzending niet bevestigd.")
    return result


async def send_whatsapp(cfg: dict, to: str, body: str, media_url: str | None = None,
                        *, template_kind: str | None = None, variables: dict | None = None) -> dict:
    template = _template(cfg, template_kind, variables) if template_kind else None
    if template:
        message = {"template": template}
    elif media_url:
        if len(body) > 1024:
            raise MessenteError("Het bijschrift van de WhatsApp-afbeelding mag maximaal 1024 tekens bevatten.")
        message = {"image": {"link": _media_url(media_url), "caption": body}}
    else:
        if not body or len(body) > 4096:
            raise MessenteError("Een WhatsApp-tekstbericht moet tussen 1 en 4096 tekens bevatten.")
        message = {"text": {"body": body}}
    return await _send(cfg, "whatsapp", to, message)


async def send_sms(cfg: dict, to: str, body: str) -> dict:
    if not body:
        raise MessenteError("SMS-bericht is leeg")
    return await _send(cfg, "sms", to, {"text": body, "autoconvert": "off"})
