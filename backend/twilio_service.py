"""Twilio WhatsApp + SMS service.

Direct REST integration (no SDK) so credentials stay encrypted-at-rest per
company and decrypted only at send-time.

API reference:
  POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json
  Basic auth: AccountSid:AuthToken
  Form fields: From, To, Body/MediaUrl or ContentSid/ContentVariables
"""
import json
import re

import httpx


class TwilioError(Exception):
    pass


TWILIO_API = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"


def _validate_number(num: str, kind: str) -> str:
    n = (num or "").strip()
    if n.startswith("whatsapp:"):
        n = n[len("whatsapp:"):].strip()
    if not n:
        raise TwilioError(f"{kind} nummer is leeg")
    n = re.sub(r"[\s().-]", "", n)
    if not re.fullmatch(r"\+[1-9][0-9]{6,14}", n):
        raise TwilioError(f"Ongeldig {kind} nummer: gebruik een nummer met landcode, bijvoorbeeld +5971234567")
    return f"whatsapp:{n}" if kind == "whatsapp" else n


def whatsapp_variables(name: str, company: str, amount: str, reference: str, link: str) -> dict:
    return {
        str(index): re.sub(r"\s+", " ", str(value or "")).strip()
        for index, value in enumerate((name, company, amount, reference, link), start=1)
    }


async def _send(cfg: dict, channel: str, to: str, body: str, media_url: str | None = None,
                *, content_sid: str | None = None, content_variables: dict | None = None) -> dict:
    """Send a single message. channel = 'sms' or 'whatsapp'."""
    sid = (cfg.get("account_sid") or "").strip()
    token = (cfg.get("auth_token") or "").strip()
    if not sid or not token:
        raise TwilioError("Account SID of Auth Token ontbreekt")
    from_field = cfg.get("whatsapp_from") if channel == "whatsapp" else cfg.get("sms_from")
    from_field = _validate_number(from_field, channel)
    to_field = _validate_number(to, channel)
    data = {"From": from_field, "To": to_field}
    if content_sid:
        if channel != "whatsapp" or not re.fullmatch(r"HX[0-9a-fA-F]{32}", content_sid):
            raise TwilioError("Ongeldige WhatsApp Content SID; verwacht HX gevolgd door 32 hexadecimale tekens.")
        if not content_variables or any(not value for value in content_variables.values()):
            raise TwilioError("De invulvelden voor de WhatsApp-template zijn niet volledig.")
        data["ContentSid"] = content_sid
        data["ContentVariables"] = json.dumps(content_variables)
    else:
        if not body:
            raise TwilioError("Bericht is leeg")
        data["Body"] = body[:1500]
        if media_url:
            data["MediaUrl"] = media_url

    url = TWILIO_API.format(sid=sid)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, data=data, auth=(sid, token))
    except (httpx.HTTPError, OSError) as e:
        raise TwilioError(f"Twilio netwerk fout: {e}") from e

    if r.status_code >= 400:
        # Twilio returns JSON {code, message, more_info, status}
        try:
            j = r.json()
            msg = j.get("message") or j.get("detail") or r.text
            code = j.get("code")
            raise TwilioError(f"Twilio fout ({code or r.status_code}): {msg}")
        except ValueError:
            raise TwilioError(f"Twilio fout ({r.status_code}): {r.text[:200]}")
    return r.json()


async def send_whatsapp(cfg: dict, to: str, body: str, media_url: str | None = None,
                        *, template_kind: str | None = None, variables: dict | None = None) -> dict:
    if not cfg.get("enabled"):
        raise TwilioError("Twilio is niet ingeschakeld")
    content_sid = None
    if template_kind:
        if template_kind not in ("receipt", "reminder"):
            raise TwilioError("Onbekende WhatsApp-template.")
        content_sid = (cfg.get(f"{template_kind}_content_sid") or "").strip()
    return await _send(cfg, "whatsapp", to, body, media_url,
                       content_sid=content_sid, content_variables=variables)


async def send_sms(cfg: dict, to: str, body: str) -> dict:
    if not cfg.get("enabled"):
        raise TwilioError("Twilio is niet ingeschakeld")
    return await _send(cfg, "sms", to, body)
