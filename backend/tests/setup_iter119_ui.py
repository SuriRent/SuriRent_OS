# Iter119 UI seed: unbound IDs owned by A (demo), by B, and unclaimed. Usage: python setup_iter119_ui.py seed|clean
import asyncio, os, sys
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
IDS = {"kiosk-uiown119": "demo-company-fixed-uuid-00000000000", "kiosk-uiother119": "9fb04645-2424-4cac-9c32-e536073c53f7", "kiosk-uifree119": None}


async def main(mode):
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    now = datetime.now(timezone.utc).isoformat()
    for kid, cid in IDS.items():
        await db.kiosk_id_owners.delete_many({"kiosk_id": kid})
        await db.kiosk_unbound_devices.delete_many({"kiosk_id": kid})
        await db.kiosk_printers.update_many({"kiosk_ids": kid}, {"$pull": {"kiosk_ids": kid}})
        if mode == "seed":
            await db.kiosk_unbound_devices.insert_one({"kiosk_id": kid, "first_seen": now, "last_seen": now})
            if cid:
                await db.kiosk_id_owners.insert_one({"kiosk_id": kid, "company_id": cid, "since": now})
    print(mode, "done")

asyncio.run(main(sys.argv[1]))
