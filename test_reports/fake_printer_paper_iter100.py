"""Fake KT-V520 printer WS; sends PRINTER_STATUS when /tmp/paper_cmd content changes. Usage: python ... DURATION"""
import asyncio, json, time, sys, os
import websockets
ctx = json.load(open("/tmp/iter85_ctx.json"))
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
WS = BASE.replace("https", "wss") + "/api/kiosk/ws"
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 300
async def main():
    async with websockets.connect(WS, open_timeout=10) as ws:
        await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": ctx["device_token"], "device": {"ua": "TEST iter100"}}))
        print("first:", await ws.recv(), flush=True)
        last, lp, end = None, 0, time.time() + DURATION
        while time.time() < end:
            cmd = open("/tmp/paper_cmd").read().strip() if os.path.exists("/tmp/paper_cmd") else "ok"
            if cmd != last:
                await ws.send(json.dumps({"type": "PRINTER_STATUS", "paper": cmd})); last = cmd
                print("sent", cmd, time.strftime("%X"), flush=True)
            if time.time() - lp > 20:
                await ws.send(json.dumps({"type": "ping"})); lp = time.time()
            try:
                await asyncio.wait_for(ws.recv(), timeout=0.5)
            except asyncio.TimeoutError:
                pass
asyncio.run(main())
