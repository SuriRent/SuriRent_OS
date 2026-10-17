"""Iter109: keep a fake KT-V520 online via WS. Usage: python fake_printer_iter111.py DEVICE_TOKEN DURATION"""
import asyncio, json, sys, time
import websockets
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
WS = BASE.replace("https", "wss") + "/api/kiosk/ws"
TOKEN = sys.argv[1]
DURATION = int(sys.argv[2]) if len(sys.argv) > 2 else 240


async def main():
    async with websockets.connect(WS, open_timeout=10) as ws:
        await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": TOKEN, "device": {"ua": "TEST iter111"}}))
        print("first:", await ws.recv(), flush=True)
        await ws.send(json.dumps({"type": "PRINTER_STATUS", "paper": "ok"}))
        end, lp = time.time() + DURATION, time.time()
        while time.time() < end:
            if time.time() - lp > 15:
                await ws.send(json.dumps({"type": "ping"})); lp = time.time()
            try:
                m = await asyncio.wait_for(ws.recv(), timeout=1)
                print("recv:", m[:200], flush=True)
                d = json.loads(m)
                if d.get("type") == "REMOTE_PRINT":
                    await ws.send(json.dumps({"type": "REMOTE_PRINT_DONE", "job_id": d.get("job_id"), "payment_id": d.get("payment_id"), "ok": True}))
            except asyncio.TimeoutError:
                pass

asyncio.run(main())
