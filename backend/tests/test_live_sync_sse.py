"""Handmatige integratie-test: SSE broadcast op admin-mutaties.

Run:  python3 backend/tests/test_live_sync_sse.py

Doet:
  1. Login als demo admin → JWT token
  2. Open SSE stream naar /api/admin/events
  3. Doe PUT op /api/companies/me/branding
  4. Verifieer dat er een `{"type":"change","path":"/api/companies/me/branding"}` event binnenkomt
"""
import asyncio
import json
import os
import sys
import time
from urllib.parse import urlencode

import httpx


API_URL = "https://vastgoed-app.preview.emergentagent.com"


async def main() -> int:
    async with httpx.AsyncClient(timeout=30.0) as client:
        # 1. Login
        r = await client.post(
            f"{API_URL}/api/auth/login",
            json={"email": "demo@surirent.sr", "password": "demo1234"},
        )
        r.raise_for_status()
        token = r.json()["token"]
        print(f"✓ Login OK, token={token[:20]}…")

        # 2. Open SSE stream (backgrounded)
        events: list[dict] = []
        stop = asyncio.Event()

        async def sse_reader() -> None:
            url = f"{API_URL}/api/admin/events?token={token}"
            async with client.stream("GET", url, timeout=None) as resp:
                async for line in resp.aiter_lines():
                    if stop.is_set():
                        break
                    if line.startswith("data:"):
                        body = line[5:].strip()
                        if not body:
                            continue
                        try:
                            data = json.loads(body)
                            events.append(data)
                            print(f"  SSE ← {data}")
                        except json.JSONDecodeError:
                            pass

        sse_task = asyncio.create_task(sse_reader())
        await asyncio.sleep(2.0)  # geef SSE tijd om te connecten
        print("✓ SSE gestart, doe nu mutaties…")

        # 3. Trigger mutaties op verschillende collecties
        for label, method, path, body in [
            ("branding", "PUT", "/api/companies/me/branding",
                {"app_name": "SuriRent N.V.", "tagline": "Live sync test"}),
            ("profile", "PUT", "/api/companies/me/profile",
                {"name": "SuriRent N.V.", "contact_email": "test@surirent.sr"}),
        ]:
            r = await client.request(
                method, f"{API_URL}{path}",
                headers={"Authorization": f"Bearer {token}"},
                json=body,
            )
            print(f"  {method} {path} → {r.status_code}")
            await asyncio.sleep(1.5)

        # 4. Wacht op events + rapport
        await asyncio.sleep(2.0)
        stop.set()
        try:
            await asyncio.wait_for(sse_task, timeout=1.0)
        except asyncio.TimeoutError:
            sse_task.cancel()

        # 5. Assert
        change_events = [e for e in events if e.get("type") == "change"]
        print(f"\n===== SAMENVATTING =====")
        print(f"Change-events ontvangen: {len(change_events)}")
        for e in change_events:
            print(f"  · {e.get('method')} {e.get('path')}")

        expected_paths = {"/api/companies/me/branding", "/api/companies/me/profile"}
        got_paths = {e["path"] for e in change_events}
        missing = expected_paths - got_paths
        if missing:
            print(f"\n✗ FAIL: geen SSE-event voor: {missing}")
            return 1
        print("\n✓ PASS: alle verwachte SSE-events ontvangen.")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
