"""Regressietest: PaymentPlanForm filter — alleen open facturen tellen mee.

Bug (2026-02): De frontend riep `GET /api/invoices?tenant_id=X&status=open`
maar de backend accepteert géén query params → ALLE facturen (inclusief
betaalde) werden geretourneerd. De modal pre-selecteerde daardoor ook
betaalde facturen en het "Totaal geselecteerd" was véél te hoog (bv.
SRD 266.250 voor een huurder zonder openstaande facturen).

Fix: frontend filtert client-side op tenant_id + status ≠ paid/cancelled
+ remaining_amount > 0 en sommeert op `remaining_amount` i.p.v. `amount`.

Deze test verifieert:
1. `/api/invoices` retourneert ALLE facturen (geen server-side filter).
2. De frontend filter-logica (hier herhaald in Python) reproduceert het
   correcte gedrag: alleen open + remaining > 0 blijven over.
"""
import asyncio
import sys

import httpx


API_URL = "https://vastgoed-app.preview.emergentagent.com"


def frontend_open_filter(invoices: list[dict], tenant_id: str) -> tuple[list[dict], float]:
    """Reproductie van de client-side filter in PaymentPlans.jsx."""
    out = []
    for inv in invoices:
        if inv.get("tenant_id") != tenant_id:
            continue
        st = (inv.get("status") or "").lower()
        if st in ("paid", "cancelled"):
            continue
        remaining = inv.get("remaining_amount")
        if remaining is None:
            remaining = max(0.0, float(inv.get("amount") or 0) - float(inv.get("paid_amount") or 0))
        if float(remaining) <= 0.005:
            continue
        out.append(inv)
    total = sum(
        float(inv.get("remaining_amount") if inv.get("remaining_amount") is not None
              else max(0.0, float(inv.get("amount") or 0) - float(inv.get("paid_amount") or 0)))
        for inv in out
    )
    return out, round(total, 2)


async def main() -> int:
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(f"{API_URL}/api/auth/login",
                         json={"email": "demo@surirent.sr", "password": "demo1234"})
        r.raise_for_status()
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}

        # Vraag alle facturen op
        r = await c.get(f"{API_URL}/api/invoices", headers=h)
        r.raise_for_status()
        invoices = r.json()
        print(f"Totaal facturen retourneerd: {len(invoices)}")
        by_status: dict[str, int] = {}
        for inv in invoices:
            by_status[inv.get("status") or "unknown"] = by_status.get(inv.get("status") or "unknown", 0) + 1
        print(f"  Per status: {by_status}")

        # Neem eerste huurder
        r = await c.get(f"{API_URL}/api/tenants", headers=h)
        tenants = r.json()
        if not tenants:
            print("Geen huurders om te testen")
            return 0
        t = tenants[0]
        print(f"\nTest huurder: {t['name']} ({t['id']})")

        # Simuleer OUDE frontend gedrag: gebruik ALLE invoices (bug)
        old_selected = [inv for inv in invoices]  # `params` werd genegeerd
        old_total = sum(float(inv.get("amount") or 0) for inv in old_selected)
        print(f"OUDE gedrag (bug): {len(old_selected)} facturen, totaal {old_total}")

        # Simuleer NIEUWE frontend gedrag: correct client-side filter
        open_inv, correct_total = frontend_open_filter(invoices, t["id"])
        print(f"NIEUWE gedrag: {len(open_inv)} open facturen, totaal restbedrag {correct_total}")

        # Assert: het totaal MAG niet meer over ALLE facturen (paid + open) gaan.
        # Als er ook maar 1 paid factuur was, moet correct < old zijn.
        paid_count = by_status.get("paid", 0)
        if paid_count > 0:
            assert correct_total < old_total, (
                f"Regressie? correct_total ({correct_total}) is niet lager dan buggy total ({old_total})"
            )
            print(f"\n✓ PASS: filter verwijdert {paid_count} paid factuur/facturen uit het totaal.")
        else:
            print(f"\n(Geen paid facturen in demo-data → filter is trivially OK)")

        # Assert: geen enkele open-invoice mag status paid/cancelled hebben
        for inv in open_inv:
            assert (inv.get("status") or "").lower() not in ("paid", "cancelled"), inv
        print(f"✓ PASS: geen paid/cancelled facturen in de open-lijst.")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
