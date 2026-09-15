"""Cross-replica event bus voor SSE broadcasts.

Vervangt in-memory `_sse_queues` en `_cd_subscribers` waarvan events enkel
de clients bereiken die tegen DEZELFDE backend-replica zitten. Door de app
op meerdere replica's te draaien (kubernetes horizontal scaling) gingen
events verloren als publisher & subscriber op verschillende pods zaten.

Werking:
  • Elke publisher (`publish`) schrijft een compact document naar een
    MongoDB CAPPED collectie `sse_events`. Capped collections zijn
    lock-free en supporteren native tailable cursors.
  • Elke replica start één enkele achtergrond-task die de collectie
    "tailed" en per nieuw document alle lokale abonnees op dat kanaal
    dispatched (via `_local_subscribers`).
  • Bij connectieverlies met MongoDB reconnect de tailable cursor
    automatisch met exp-backoff.

Zonder Redis, zonder pub/sub server — puur bestaande MongoDB.

API:
    await ensure_started(db)              # roep 1x aan bij app startup
    await publish(channel, payload)       # thread-safe cross-replica push
    q = subscribe(channel)                # asyncio.Queue voor consumer
    unsubscribe(channel, q)               # opruimen bij disconnect
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorDatabase, AsyncIOMotorCollection
from pymongo.errors import CollectionInvalid, OperationFailure

_logger = logging.getLogger("event_bus")

# Capped collectie configuratie — 4MB en max 20k documenten. Een SSE
# event is ~200 bytes dus dit dekt ~20k events voor we oude overwriten.
# Ruim genoeg voor een korte gap bij restart, klein genoeg voor RAM.
_CAPPED_SIZE_BYTES = 4 * 1024 * 1024
_CAPPED_MAX_DOCS = 20_000
_COLLECTION_NAME = "sse_events"

# --- Module state ------------------------------------------------------
_db: Optional[AsyncIOMotorDatabase] = None
_coll: Optional[AsyncIOMotorCollection] = None
_started = False
_tail_task: Optional[asyncio.Task] = None
# {channel: set[asyncio.Queue]}  —  dispatch target voor tailable loop
_local_subscribers: dict[str, set] = {}
_lock = asyncio.Lock()


async def ensure_started(db: AsyncIOMotorDatabase) -> None:
    """Idempotent: initialiseert capped collection en start tailable loop.
    Bij app startup 1x aanroepen. Meerdere aanroepen zijn no-op."""
    global _db, _coll, _started, _tail_task
    if _started:
        return
    _db = db
    # Maak capped collection als hij nog niet bestaat (idempotent). Als er
    # al een NON-capped 'sse_events' bestaat wordt CollectionInvalid ge-
    # raised — we laten dat door zodat de operator het handmatig kan
    # oplossen (drop + recreate). In productie draait dit slechts 1x.
    try:
        await db.create_collection(
            _COLLECTION_NAME, capped=True,
            size=_CAPPED_SIZE_BYTES, max=_CAPPED_MAX_DOCS,
        )
        _logger.info("event_bus: capped collection '%s' aangemaakt", _COLLECTION_NAME)
    except CollectionInvalid:
        pass  # bestaat al — verwacht na 1e run
    except OperationFailure as exc:
        # 48 = "NamespaceExists" (soms geretourneerd i.p.v. CollectionInvalid)
        if getattr(exc, "code", None) not in (48,):
            _logger.warning("event_bus: create_collection warning: %s", exc)
    _coll = db[_COLLECTION_NAME]
    # Insert een sentinel document zodat een fresh tailable cursor bij
    # startup direct data heeft (anders wacht `tail_cursor` initieel).
    try:
        await _coll.insert_one({"channel": "__init__", "payload": {}, "ts": time.time()})
    except Exception:  # noqa: BLE001
        pass
    _tail_task = asyncio.create_task(_tail_loop(), name="event_bus.tail_loop")
    _started = True


async def publish(channel: str, payload: dict) -> None:
    """Publiceert een event naar het kanaal. Bereikt alle replica's die
    op deze DB verbonden zijn. Fire-and-forget — errors worden gelogd
    maar propageren niet, zodat de aanroepende request niet hangt."""
    if not channel or _coll is None:
        return
    try:
        await _coll.insert_one({
            "channel": channel,
            "payload": payload,
            "ts": time.time(),
        })
    except Exception as exc:  # noqa: BLE001
        _logger.warning("event_bus.publish fout op kanaal %s: %s", channel, exc)


def subscribe(channel: str, *, maxsize: int = 100) -> asyncio.Queue:
    """Registreert een lokale abonnee op een kanaal en geeft een Queue
    terug waar de tailable-loop nieuwe events op post. De caller moet
    `unsubscribe(channel, queue)` roepen bij disconnect."""
    q: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
    _local_subscribers.setdefault(channel, set()).add(q)
    return q


def unsubscribe(channel: str, q: asyncio.Queue) -> None:
    """Verwijdert een queue uit de lokale registry. Idempotent."""
    subs = _local_subscribers.get(channel)
    if not subs:
        return
    subs.discard(q)
    if not subs:
        _local_subscribers.pop(channel, None)


def local_subscriber_count(channel: str) -> int:
    """Debug-helper — hoeveel lokale connecties luisteren op dit kanaal
    op DEZE replica. Cross-replica totaal is niet in-process bekend."""
    return len(_local_subscribers.get(channel, ()))


# =====================================================================
# Interne tail loop — polling-based i.p.v. tailable cursor.
# Motor's tailable_await werkte niet betrouwbaar in onze deployment
# (mogelijk mongo-mode/versie). Polling met 200ms sleep geeft ~100ms
# gemiddelde latency — ruim binnen SSE-perceptibele grenzen — en is
# 100% robuust ongeacht mongo-configuratie (standalone / replica-set).
# =====================================================================
_POLL_INTERVAL = 0.2  # seconde tussen polls; 0.2 = ~100ms gemiddelde latency


async def _tail_loop() -> None:
    """Poll de capped collectie op nieuwe events (>_last_id) en dispatch
    naar lokale abonnees. Robuust: reconnect met exp-backoff bij fout."""
    assert _coll is not None
    delay = 0.5
    # Startpunt: laatste _id op moment van start — historische spam bij
    # replica-restart niet nuttig want clients re-fetchen sowieso.
    last_doc = await _coll.find_one(sort=[("$natural", -1)])
    last_id = last_doc.get("_id") if last_doc else None

    while True:
        try:
            cursor = _coll.find(
                {"_id": {"$gt": last_id}} if last_id else {},
                sort=[("$natural", 1)],
            )
            batch_count = 0
            async for doc in cursor:
                last_id = doc["_id"]
                batch_count += 1
                channel = doc.get("channel")
                if not channel or channel == "__init__":
                    continue
                payload = doc.get("payload") or {}
                for q in list(_local_subscribers.get(channel, ())):
                    try:
                        q.put_nowait(payload)
                    except asyncio.QueueFull:
                        _logger.debug("event_bus: queue vol op %s, gedropt", channel)
                    except Exception:  # noqa: BLE001
                        pass
            # Backoff reset na succesvolle poll
            delay = 0.5
            # Als batch leeg was → wacht kort. Bij bursts blijf snel pollen.
            await asyncio.sleep(_POLL_INTERVAL if batch_count == 0 else 0.02)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            _logger.warning("event_bus.tail_loop error, retry in %.1fs: %s", delay, exc)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)


async def shutdown() -> None:
    """Optioneel: cancel de tail-task bij graceful shutdown."""
    global _tail_task, _started
    if _tail_task and not _tail_task.done():
        _tail_task.cancel()
        try:
            await _tail_task
        except asyncio.CancelledError:
            pass
    _tail_task = None
    _started = False
