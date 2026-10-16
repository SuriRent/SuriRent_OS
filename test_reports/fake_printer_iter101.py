"""Fake KT-V520 printer WS. Usage: python fake_printer_iter101.py DURATION TOKEN_KEY CMD_FILE
Sends PRINTER_STATUS when CMD_FILE content changes; writes 'quit' to CMD_FILE to disconnect."""
import asyncio, json, time, sys, os
import websockets
ctx = json.load(open("/tmp/iter85_ctx.json"))
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
WS = BASE.replace("https", "wss") + "/api/kiosk/ws"
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 300
KEY = sys.argv[2] if len(sys.argv) > 2 else "device_token"
CMD = sys.argv[3] if len(sys.argv) > 3 else "/tmp/paper_cmd"


async def main():
    async with websockets.connect(WS, open_timeout=10) as ws:
        await ws.send(json.dumps({"type": "auth", "role": "printer", "device_token": ctx[KEY], "device": {"ua": "TEST iter101"}}))
        print("first:", await ws.recv(), flush=True)
        last, lp, end = None, 0, time.time() + DURATION
        while time.time() < end:
            cmd = open(CMD).read().strip() if os.path.exists(CMD) else "ok"
            if cmd == "quit":
                print("quit", time.strftime("%X"), flush=True)
                return
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
