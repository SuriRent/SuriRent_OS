"""Keep the fake KT-V520 (from /tmp/iter85_ctx.json) online: WS role=printer + refresh last_seen."""
import asyncio, json, time, sys
import websockets
from pymongo import MongoClient

ctx = json.load(open("/tmp/iter85_ctx.json"))
WS = "wss://vastgoed-app.preview.emergentagent.com/api/kiosk/ws"
DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 120
db = MongoClient("mongodb://localhost:27017")["vastgoed_kiosk"]


async def main():
    async with websockets.connect(WS, open_timeout=10) as ws:
        await ws.send(json.dumps({"role": "printer", "device_token": ctx["device_token"],
                                  "device": {"ua": "TEST iter98", "ktp_detected": True}}))
        print("first msg:", await asyncio.wait_for(ws.recv(), timeout=10), flush=True)
        end = time.time() + DURATION
        while time.time() < end:
            db.kiosk_printers.update_one({"id": ctx["printer_id"]}, {"$set": {"last_seen": time.time()}})
            await ws.send(json.dumps({"type": "ping"}))
            try:
                while True:
                    await asyncio.wait_for(ws.recv(), timeout=10)
            except asyncio.TimeoutError:
                pass
    print("done", flush=True)

asyncio.run(main())
