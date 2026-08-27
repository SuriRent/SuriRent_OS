"""AI-assistent voor de vastgoed-app.

Aparte FastAPI router die een chat-endpoint aanbiedt met tool-calling naar
de bestaande app-data. Gebruikt Claude Sonnet 5 via Emergent Universal Key.

Toegang wordt bepaald door `ai_assistant_enabled` op de user (admin krijgt
altijd toegang; werknemer krijgt via toggle in Instellingen).
"""
from __future__ import annotations
import os
import json
from typing import Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAISpeechToText, OpenAITextToSpeech

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

# -----------------------------------------------------------------
# Tools — worden aan Claude aangeboden en op dispatch uitgevoerd tegen db.
# -----------------------------------------------------------------
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "lookup_tenant",
            "description": "Zoek een huurder op naam (deel van de naam is voldoende). Retourneert huurder-info met appartement en achterstand.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Naam of deel van de naam"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_apartment",
            "description": "Zoek een appartement op label (bv. 'HUIS 7J'). Retourneert appartement-info, huurder en huurbedrag.",
            "parameters": {
                "type": "object",
                "properties": {"label": {"type": "string"}},
                "required": ["label"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_overdue",
            "description": "Toon huurders met achterstallige betalingen.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_open_invoices",
            "description": "Toon alle openstaande facturen. Optioneel filter op appartement of huurder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "apartment_label": {"type": "string"},
                    "tenant_name": {"type": "string"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "register_payment",
            "description": "Registreer een betaling voor een appartement of huurder. Gebruik dit voor uitspraken zoals 'Huis 7J heeft SRD 5000 betaald'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "apartment_label": {"type": "string", "description": "Bv. 'HUIS 7J'"},
                    "tenant_name": {"type": "string", "description": "Alternatief: huurder-naam"},
                    "amount": {"type": "number"},
                    "currency": {"type": "string", "enum": ["SRD", "EUR", "USD"], "default": "SRD"},
                    "method": {"type": "string", "enum": ["contant", "bank"], "default": "contant"},
                    "note": {"type": "string"},
                },
                "required": ["amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_invoice",
            "description": "Maak een nieuwe factuur aan voor een appartement of huurder.",
            "parameters": {
                "type": "object",
                "properties": {
                    "apartment_label": {"type": "string"},
                    "tenant_name": {"type": "string"},
                    "amount": {"type": "number"},
                    "currency": {"type": "string", "enum": ["SRD", "EUR", "USD"], "default": "SRD"},
                    "category": {"type": "string", "enum": ["huur", "servicekosten", "borg", "overig"], "default": "huur"},
                    "due_days": {"type": "integer", "description": "Aantal dagen tot vervaldatum", "default": 14},
                },
                "required": ["amount"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_contract",
            "description": "Toon contractinfo voor een huurder of appartement.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tenant_name": {"type": "string"},
                    "apartment_label": {"type": "string"},
                },
                "required": [],
            },
        },
    },
]

SYSTEM_MESSAGE = """Je bent de AI-assistent voor SuriRent, een vastgoedbeheer-app.

BELANGRIJK — Je antwoordt in TWEE STAPPEN:

STAP 1: Als de gebruiker om acties vraagt (registreer betaling, maak factuur, zoek huurder, achterstand, etc.), antwoord EERST met EXACT dit format:
ACTIONS: <JSON-array>

Bijvoorbeeld:
Gebruiker: "Huis 7J heeft SRD 5000 betaald"
Jij: ACTIONS: [{"tool":"register_payment","args":{"apartment_label":"HUIS 7J","amount":5000,"method":"contant"}}]

Gebruiker: "Wie heeft achterstand?"
Jij: ACTIONS: [{"tool":"list_overdue","args":{}}]

STAP 2 (automatisch): Nadat je resultaten krijgt, formuleer een KORT Nederlands antwoord met bullets.

Beschikbare tools:
- lookup_tenant(query: str) — zoek huurder op naam
- lookup_apartment(label: str) — zoek appartement (bv. "HUIS 7J")
- list_overdue() — huurders met achterstallige betalingen
- list_open_invoices(apartment_label?: str, tenant_name?: str) — openstaande facturen
- register_payment(apartment_label?: str, tenant_name?: str, amount: float, currency?: "SRD"|"EUR"|"USD", method?: "contant"|"bank", note?: str)
- create_invoice(apartment_label?: str, tenant_name?: str, amount: float, currency?: str, category?: "huur"|"servicekosten"|"borg"|"overig", due_days?: int)
- get_contract(tenant_name?: str, apartment_label?: str)

Regels:
- Antwoord ALTIJD in het Nederlands.
- Verzin nooit data.
- Als iets onduidelijk is: reageer ZONDER ACTIONS-prefix, stel gewoon een verduidelijkende vraag.
- SRD is standaard currency, contant is standaard method.
- Wees kort en zakelijk."""


async def _resolve_apartment(db, cid: str, label: Optional[str]) -> Optional[dict]:
    if not label:
        return None
    q = label.strip().upper()
    apt = await db.apartments.find_one(
        {"company_id": cid, "label": {"$regex": f"^{q}$", "$options": "i"}}, {"_id": 0}
    )
    if not apt:
        # Fuzzy match
        apt = await db.apartments.find_one(
            {"company_id": cid, "label": {"$regex": q, "$options": "i"}}, {"_id": 0}
        )
    return apt


async def _resolve_tenant(db, cid: str, name: Optional[str]) -> Optional[dict]:
    if not name:
        return None
    return await db.tenants.find_one(
        {"company_id": cid, "name": {"$regex": name.strip(), "$options": "i"}}, {"_id": 0}
    )


async def dispatch_tool(name: str, args: dict, *, db, user: dict) -> dict:
    """Voer een tool-call uit tegen de database van het bedrijf van de user."""
    from server import (  # lokale import — voorkomt circulaire dependency
        company_id_of, new_id, iso, now_utc,
    )
    cid = company_id_of(user)
    if not cid:
        return {"error": "Geen actief bedrijf gekoppeld aan gebruiker."}

    try:
        if name == "lookup_tenant":
            t = await _resolve_tenant(db, cid, args.get("query"))
            if not t:
                return {"found": False, "message": "Geen huurder gevonden."}
            apt = await db.apartments.find_one({"id": t.get("apartment_id"), "company_id": cid}, {"_id": 0})
            return {
                "found": True, "name": t.get("name"), "email": t.get("email"),
                "phone": t.get("phone"), "apartment": apt.get("label") if apt else None,
                "monthly_rent": apt.get("rent") if apt else None,
                "currency": apt.get("currency") if apt else "SRD",
            }

        if name == "lookup_apartment":
            apt = await _resolve_apartment(db, cid, args.get("label"))
            if not apt:
                return {"found": False, "message": "Appartement niet gevonden."}
            t = None
            if apt.get("tenant_id"):
                t = await db.tenants.find_one({"id": apt["tenant_id"]}, {"_id": 0})
            return {
                "found": True, "label": apt.get("label"), "rent": apt.get("rent"),
                "currency": apt.get("currency"), "occupied": bool(apt.get("tenant_id")),
                "tenant": t.get("name") if t else None,
            }

        if name == "list_overdue":
            cur = db.invoices.find(
                {"company_id": cid, "status": {"$in": ["open", "overdue", "partially_paid"]}},
                {"_id": 0},
            ).limit(50)
            invs = await cur.to_list(length=50)
            today = datetime.now(timezone.utc).date().isoformat()
            overdue = [i for i in invs if (i.get("due_date") or "9999") < today]
            return {"count": len(overdue), "items": [
                {"id": i.get("id"), "apartment": i.get("apartment_label"),
                 "tenant": i.get("tenant_name"), "amount": i.get("balance") or i.get("amount"),
                 "currency": i.get("currency"), "due_date": i.get("due_date")}
                for i in overdue[:20]
            ]}

        if name == "list_open_invoices":
            filt = {"company_id": cid, "status": {"$in": ["open", "overdue", "partially_paid"]}}
            if args.get("apartment_label"):
                apt = await _resolve_apartment(db, cid, args["apartment_label"])
                if apt:
                    filt["apartment_id"] = apt["id"]
            if args.get("tenant_name"):
                t = await _resolve_tenant(db, cid, args["tenant_name"])
                if t:
                    filt["tenant_id"] = t["id"]
            invs = await db.invoices.find(filt, {"_id": 0}).limit(30).to_list(length=30)
            return {"count": len(invs), "items": [
                {"id": i.get("id"), "apartment": i.get("apartment_label"),
                 "tenant": i.get("tenant_name"), "amount": i.get("balance") or i.get("amount"),
                 "currency": i.get("currency"), "due_date": i.get("due_date")}
                for i in invs
            ]}

        if name == "register_payment":
            apt = await _resolve_apartment(db, cid, args.get("apartment_label"))
            tenant = await _resolve_tenant(db, cid, args.get("tenant_name"))
            if not tenant and apt and apt.get("tenant_id"):
                tenant = await db.tenants.find_one({"id": apt["tenant_id"]}, {"_id": 0})
            if not tenant:
                return {"error": "Kan geen huurder vinden. Geef appartement-label of huurder-naam."}
            # Gebruik de reguliere payment-pipeline zodat receipt_number,
            # invoice-koppeling, allocaties en admin-filters correct werken.
            # Dit voorkomt schema-drift en garandeert dat de betaling in het
            # admin-dashboard verschijnt (zelfde pad als POST /api/payments).
            from server import _create_payment_doc, _enrich_payment  # lokale import
            from models import PaymentIn
            pin = PaymentIn(
                tenant_id=tenant["id"],
                apartment_id=(apt["id"] if apt else tenant.get("apartment_id")),
                amount=float(args["amount"]),
                currency=(args.get("currency") or "SRD").upper(),
                method=args.get("method") or "contant",
                category="huur",
                note=(args.get("note") or "Via AI-assistent").strip(),
                received_by=user.get("name") or user.get("email") or "",
            )
            doc = await _create_payment_doc(
                pin, cid, approved_by=user.get("name") or user.get("email"),
            )
            # Markeer bron zodat we later AI-registraties kunnen filteren/auditen.
            await db.payments.update_one(
                {"id": doc["id"]}, {"$set": {"source": "ai_assistant"}}
            )
            enriched = await _enrich_payment(doc)
            return {
                "success": True,
                "payment_id": enriched.get("id"),
                "receipt_number": enriched.get("receipt_number"),
                "amount": enriched.get("amount"),
                "currency": enriched.get("currency"),
                "tenant": enriched.get("tenant_name") or tenant["name"],
                "apartment": (apt or {}).get("label") or enriched.get("apartment_number") or "",
                "invoice_number": enriched.get("invoice_number"),
            }

        if name == "create_invoice":
            apt = await _resolve_apartment(db, cid, args.get("apartment_label"))
            tenant = await _resolve_tenant(db, cid, args.get("tenant_name"))
            if not tenant and apt and apt.get("tenant_id"):
                tenant = await db.tenants.find_one({"id": apt["tenant_id"]}, {"_id": 0})
            if not tenant:
                return {"error": "Kan geen huurder vinden. Geef appartement-label of huurder-naam."}
            from datetime import timedelta
            due = (datetime.now(timezone.utc) + timedelta(days=int(args.get("due_days", 14)))).date().isoformat()
            inv = {
                "id": new_id(), "company_id": cid,
                "tenant_id": tenant["id"], "tenant_name": tenant["name"],
                "apartment_id": apt["id"] if apt else tenant.get("apartment_id"),
                "apartment_label": apt["label"] if apt else "",
                "amount": float(args["amount"]),
                "balance": float(args["amount"]),
                "currency": (args.get("currency") or "SRD").upper(),
                "category": args.get("category") or "huur",
                "due_date": due, "status": "open",
                "created_at": iso(now_utc()), "created_by": user.get("email"),
                "source": "ai_assistant",
            }
            await db.invoices.insert_one(inv)
            inv.pop("_id", None)
            return {"success": True, "invoice_id": inv["id"], "amount": inv["amount"],
                    "currency": inv["currency"], "due_date": inv["due_date"],
                    "tenant": inv["tenant_name"]}

        if name == "get_contract":
            apt = await _resolve_apartment(db, cid, args.get("apartment_label"))
            tenant = await _resolve_tenant(db, cid, args.get("tenant_name"))
            if not tenant and apt and apt.get("tenant_id"):
                tenant = await db.tenants.find_one({"id": apt["tenant_id"]}, {"_id": 0})
            if not tenant:
                return {"error": "Huurder niet gevonden."}
            c = await db.contracts.find_one(
                {"company_id": cid, "tenant_id": tenant["id"]}, {"_id": 0},
                sort=[("start_date", -1)],
            )
            if not c:
                return {"found": False, "message": f"Geen contract voor {tenant['name']}."}
            return {
                "found": True, "tenant": tenant["name"],
                "apartment": c.get("apartment_label"), "rent": c.get("rent_amount"),
                "currency": c.get("currency"), "start_date": c.get("start_date"),
                "end_date": c.get("end_date"), "status": c.get("status"),
            }

        return {"error": f"Onbekende tool: {name}"}

    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


# -----------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------
class ChatIn(BaseModel):
    message: str
    session_id: Optional[str] = None


def _has_ai_access(user: dict) -> bool:
    role = user.get("role")
    if role in ("admin", "superadmin", "owner"):
        return True
    return bool(user.get("ai_assistant_enabled"))


@router.post("/chat")
async def assistant_chat(body: ChatIn, request: Request):
    from server import get_current_user, db  # lokale import
    user = await get_current_user(request)
    if not _has_ai_access(user):
        raise HTTPException(status_code=403, detail="Geen toegang tot AI-assistent")

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY ontbreekt.")

    session_id = body.session_id or f"assistant-{user.get('id')}-{int(datetime.now().timestamp())}"
    chat = (LlmChat(api_key=key, session_id=session_id, system_message=SYSTEM_MESSAGE)
            .with_model("anthropic", "claude-sonnet-4-5"))

    try:
        # Stap 1: LLM parseert de user-message; geeft ACTIONS: [...] of vraagt om verduidelijking.
        first = await chat.send_message(UserMessage(text=body.message))
        actions = []
        if isinstance(first, str) and first.strip().startswith("ACTIONS:"):
            raw = first.strip()[len("ACTIONS:"):].strip()
            # Verwijder eventuele ```json code-fences
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw
                if raw.endswith("```"):
                    raw = raw[:raw.rfind("```")]
            try:
                calls = json.loads(raw)
                if not isinstance(calls, list):
                    calls = [calls]
            except Exception:  # noqa: BLE001
                calls = []
            # Voer elke tool uit.
            for c in calls:
                name = c.get("tool")
                args = c.get("args", {}) or {}
                result = await dispatch_tool(name, args, db=db, user=user)
                actions.append({"tool": name, "args": args, "result": result})
            # Stap 2: geef resultaten terug aan de LLM voor de finale samenvatting.
            summary_prompt = (
                "De volgende tool-resultaten zijn zojuist uitgevoerd:\n\n"
                f"{json.dumps(actions, ensure_ascii=False, default=str, indent=2)}\n\n"
                "Formuleer nu een kort Nederlands antwoord voor de gebruiker "
                "(zonder ACTIONS-prefix). Gebruik bullets als er meerdere items zijn. "
                "Als een tool 'success' retourneerde: bevestig dat kort met bedrag en huurder. "
                "Als een tool 'error' bevatte: leg het probleem uit."
            )
            reply_msg = await chat.send_message(UserMessage(text=summary_prompt))
            reply = str(reply_msg) if reply_msg else "Klaar."
        else:
            # Geen actie — LLM stelt gewoon een vraag of geeft info.
            reply = str(first) if first else ""

        return {"reply": reply, "actions": actions, "session_id": session_id}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"AI-fout: {e}")


class ToggleIn(BaseModel):
    enabled: bool


@router.put("/employees/{employee_id}/access")
async def toggle_employee_ai(employee_id: str, body: ToggleIn, request: Request):
    """Beheerder zet AI-assistent toegang aan/uit voor een werknemer."""
    from server import get_current_user, db, company_id_of  # lokale import
    admin = await get_current_user(request)
    if admin.get("role") not in ("admin", "superadmin", "owner"):
        raise HTTPException(status_code=403, detail="Alleen beheerders")
    cid = company_id_of(admin)
    emp = await db.employees.find_one({"id": employee_id, "company_id": cid})
    if not emp:
        raise HTTPException(status_code=404, detail="Werknemer niet gevonden")
    await db.employees.update_one(
        {"id": employee_id}, {"$set": {"ai_assistant_enabled": bool(body.enabled)}}
    )
    # Sync ook de gekoppelde user-account (indien aanwezig via email)
    email = (emp.get("email") or "").lower().strip()
    if email:
        await db.users.update_one(
            {"email": email}, {"$set": {"ai_assistant_enabled": bool(body.enabled)}}
        )
    return {"ok": True, "enabled": bool(body.enabled)}


@router.get("/me")
async def my_ai_status(request: Request):
    """Frontend gebruikt dit om te checken of user AI mag gebruiken (voor
    login redirect / feature gating in het /assistent scherm)."""
    from server import get_current_user  # lokale import
    user = await get_current_user(request)
    return {
        "email": user.get("email"),
        "name": user.get("name"),
        "role": user.get("role"),
        "ai_assistant_enabled": _has_ai_access(user),
        "company_id": user.get("company_id"),
    }


# -----------------------------------------------------------------
# Voice — STT (Whisper) + TTS (OpenAI TTS) via Emergent Universal Key
# -----------------------------------------------------------------
# Beide gebruiken de EMERGENT_LLM_KEY; geen aparte API-sleutel nodig.
# STT: browser stuurt opname (webm/mp4) → transcriptie in Nederlands.
# TTS: reply-tekst → mp3 audio bytes → frontend speelt direct af.
# Let op: OpenAI TTS-voices zijn getraind op Engels; Nederlands wordt
# begrepen (Whisper-taalset) maar houdt een lichte Engelse tongval —
# dat is een provider-plafond, niet iets wat we hier kunnen tunen.
# Voice "nova" klinkt in de praktijk het meest neutraal voor NL.


@router.post("/stt")
async def assistant_stt(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("nl"),
):
    """Transcribeer een opname naar tekst (Whisper via Emergent LLM Key).

    Frontend uploadt de MediaRecorder-blob als multipart/form-data.
    Retourneert `{ text: "..." }`.
    """
    from server import get_current_user  # lokale import
    user = await get_current_user(request)
    if not _has_ai_access(user):
        raise HTTPException(status_code=403, detail="Geen toegang tot AI-assistent")

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY ontbreekt.")

    # Whisper ondersteunt max 25 MB. Lees veilig in.
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Lege audio-upload.")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio te groot (max 25 MB).")

    # Schrijf naar een temp file — de SDK verwacht een file-like object met
    # een naam/extensie zodat OpenAI het format herkent. webm is de default
    # van MediaRecorder in Chrome; Safari levert mp4/m4a.
    import tempfile
    suffix = ".webm"
    ct = (file.content_type or "").lower()
    if "mp4" in ct or "m4a" in ct or "aac" in ct:
        suffix = ".m4a"
    elif "wav" in ct:
        suffix = ".wav"
    elif "mpeg" in ct or "mp3" in ct:
        suffix = ".mp3"

    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
            tmp.write(raw)
            tmp.flush()
            tmp.seek(0)
            stt = OpenAISpeechToText(api_key=key)
            with open(tmp.name, "rb") as af:
                resp = await stt.transcribe(
                    file=af,
                    model="whisper-1",
                    response_format="json",
                    language=(language or "nl").strip().lower()[:2] or "nl",
                )
        text = getattr(resp, "text", None) or (resp.get("text") if isinstance(resp, dict) else "") or ""
        return {"text": str(text).strip()}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"STT-fout: {e}")


class TtsIn(BaseModel):
    text: str
    voice: Optional[str] = "nova"  # nova klinkt het meest neutraal voor NL


def _clean_for_tts(text: str) -> str:
    """Strip emoji, markdown en URLs voor natuurlijk klinkende TTS."""
    import re
    t = text or ""
    # Emoji-range weghalen (uitgebreide unicode)
    t = re.sub(
        r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF]",
        "", t,
    )
    t = re.sub(r"https?://\S+", "", t)          # URLs
    t = re.sub(r"`{1,3}[^`]*`{1,3}", "", t)     # code-spans
    t = re.sub(r"[*_#>~|]", "", t)               # markdown-tekens
    return re.sub(r"\s+", " ", t).strip()


@router.post("/tts")
async def assistant_tts(body: TtsIn, request: Request):
    """Zet tekst om naar mp3-audio (OpenAI TTS via Emergent LLM Key)."""
    from server import get_current_user  # lokale import
    user = await get_current_user(request)
    if not _has_ai_access(user):
        raise HTTPException(status_code=403, detail="Geen toegang tot AI-assistent")

    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY ontbreekt.")

    text = _clean_for_tts(body.text)
    if not text:
        raise HTTPException(status_code=400, detail="Lege tekst voor TTS.")
    if len(text) > 4096:
        text = text[:4093] + "..."

    valid_voices = {"alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"}
    voice = (body.voice or "nova").lower()
    if voice not in valid_voices:
        voice = "nova"

    try:
        tts = OpenAITextToSpeech(api_key=key)
        audio_bytes = await tts.generate_speech(
            text=text, model="tts-1", voice=voice, response_format="mp3",
        )
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"TTS-fout: {e}")
