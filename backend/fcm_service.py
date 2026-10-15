"""Firebase Cloud Messaging (HTTP v1) — pushmeldingen naar de Android-app."""
import asyncio
import base64
import json
import os

import httpx
from google.auth.transport.requests import Request
from google.oauth2 import service_account

_SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]
_PROJECT_ID = os.environ.get("FCM_PROJECT_ID", "")
_SA_B64 = os.environ.get("FCM_SERVICE_ACCOUNT_B64", "")

_credentials = None
_lock = asyncio.Lock()
_limit = asyncio.Semaphore(20)
_client: httpx.AsyncClient | None = None


def fcm_configured() -> bool:
    return bool(_PROJECT_ID and _SA_B64)


def _creds():
    global _credentials
    if _credentials is None:
        info = json.loads(base64.b64decode(_SA_B64))
        _credentials = service_account.Credentials.from_service_account_info(info, scopes=_SCOPES)
    return _credentials


async def _access_token() -> str:
    async with _lock:
        c = _creds()
        if not c.valid or not c.token:
            await asyncio.to_thread(c.refresh, Request())
        return c.token


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    return _client


async def _send_one(token: str, title: str, body: str, data: dict) -> str:
    """Return 'ok', 'unregistered' of 'error'."""
    msg = {"message": {
        "token": token,
        "notification": {"title": title[:120], "body": body[:1000]},
        "data": {k: str(v) for k, v in (data or {}).items() if v is not None},
        "android": {"priority": "HIGH", "notification": {"sound": "default", "channel_id": "surirent_default"}},
    }}
    url = f"https://fcm.googleapis.com/v1/projects/{_PROJECT_ID}/messages:send"
    for attempt in range(3):
        try:
            bearer = await _access_token()
            async with _limit:
                r = await _http().post(url, json=msg, headers={"Authorization": f"Bearer {bearer}"})
            if r.is_success:
                return "ok"
            err = (r.json().get("error") or {}) if r.headers.get("content-type", "").startswith("application/json") else {}
            details = json.dumps(err.get("details") or [])
            if r.status_code == 404 or "UNREGISTERED" in details or (r.status_code == 400 and "registration token" in str(err.get("message", "")).lower()):
                return "unregistered"
            if (r.status_code == 429 or r.status_code >= 500) and attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            print(f"[fcm] send failed {r.status_code}: {err.get('status')} {err.get('message')}")
            return "error"
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            print(f"[fcm] network error: {type(exc).__name__}")
            return "error"
    return "error"


async def send_fcm(tokens: list, title: str, body: str, data: dict | None = None) -> dict:
    """Stuur naar meerdere tokens; geeft {'sent': n, 'unregistered': [tokens]}."""
    if not fcm_configured() or not tokens:
        return {"sent": 0, "unregistered": []}
    results = await asyncio.gather(*[_send_one(t, title, body, data or {}) for t in tokens], return_exceptions=True)
    return {
        "sent": sum(1 for r in results if r == "ok"),
        "unregistered": [t for t, r in zip(tokens, results) if r == "unregistered"],
    }
