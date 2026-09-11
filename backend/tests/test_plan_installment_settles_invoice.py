"""Regressietest: betalingsregeling termijn-betaling VERREKENT de gekoppelde factuur.

Bug (2026-02): gebruiker rapporteert dat termijnen betaald worden op de
betalingsregeling maar de gekoppelde factuur blijft "open 8500".

Deze test:
  1. Login als demo admin
  2. Maak een factuur (of gebruik bestaande) voor huurder
  3. Maak een payment plan met 2 termijnen die de factuur dekken
  4. Betaal termijn 1 via admin endpoint
  5. Verifieer dat invoice.paid_amount is opgelopen met termijn1-bedrag
  6. Betaal termijn 2
  7. Verifieer dat invoice.paid_amount == totaal en status == "paid"
"""
import asyncio
import sys
import httpx

API_URL = "https://vastgoed-app.preview.emergentagent.com"


async def main() -> int:
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.post(f"{API_URL}/api/auth/login",
                         json={"email": "demo@surirent.sr", "password": "demo1234"})
        r.raise_for_status()
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}
        print("✓ Login OK")

        # Pak een tenant met open invoice
        r = await c.get(f"{API_URL}/api/invoices", headers=h)
        invs = r.json()
        open_inv = next((i for i in invs
                        if (i.get("status") or "").lower() not in ("paid", "cancelled")
                        and Number(i.get("remaining_amount")) > 100), None)
        if not open_inv:
            print("✗ Geen geschikte open factuur — maak eerst één handmatig")
            return 1
        print(f"Test factuur: {open_inv['invoice_number']} tenant={open_inv['tenant_id']} amount={open_inv['amount']} paid={open_inv.get('paid_amount', 0)}")

        # Vraag: is er al een actief plan? Zo ja: skip create
        r = await c.get(f"{API_URL}/api/payment-plans?status=active", headers=h)
        existing = [p for p in r.json() if open_inv["id"] in (p.get("invoice_ids") or [])]
        if existing:
            plan = existing[0]
            print(f"✓ Actief plan bestaat al: {plan['id'][:8]}, termijnen={len(plan.get('installments', []))}")
        else:
            # Maak nieuw plan
            remaining = float(open_inv.get("remaining_amount") or open_inv["amount"])
            body = {
                "tenant_id": open_inv["tenant_id"],
                "invoice_ids": [open_inv["id"]],
                "total_amount": remaining,
                "currency": open_inv.get("currency") or "SRD",
                "num_installments": 2,
                "start_date": "2026-02-01",
                "frequency": "monthly",
            }
            r = await c.post(f"{API_URL}/api/payment-plans", headers=h, json=body)
            if r.status_code != 200:
                print(f"✗ Kon plan niet maken: {r.status_code} {r.text[:200]}")
                return 1
            plan = r.json()
            print(f"✓ Plan aangemaakt: {plan['id'][:8]}")

        # Toon plan installments
        for i in plan.get("installments", []):
            print(f"  Termijn {i['sequence']}: {i['amount']} status={i['status']}")

        # Vind eerst pending termijn
        pending = next((i for i in plan.get("installments", []) if i["status"] == "pending"), None)
        if not pending:
            print("Geen pending termijnen meer — plan is voltooid")
            return 0

        # Snapshot: invoice paid_amount voor
        r = await c.get(f"{API_URL}/api/invoices", headers=h)
        inv_before = next(i for i in r.json() if i["id"] == open_inv["id"])
        paid_before = float(inv_before.get("paid_amount") or 0)
        print(f"\nInvoice voor betaling: paid_amount={paid_before}, status={inv_before.get('status')}")

        # Betaal termijn
        r = await c.post(
            f"{API_URL}/api/payment-plans/{plan['id']}/installments/{pending['sequence']}/pay",
            headers=h, json={"method": "contant"},
        )
        if r.status_code != 200:
            print(f"✗ Termijn-betaling faalde: {r.status_code} {r.text[:200]}")
            return 1
        print(f"✓ Termijn {pending['sequence']} betaald (bedrag: {pending['amount']})")

        # Snapshot: invoice paid_amount na
        await asyncio.sleep(0.5)
        r = await c.get(f"{API_URL}/api/invoices", headers=h)
        inv_after = next(i for i in r.json() if i["id"] == open_inv["id"])
        paid_after = float(inv_after.get("paid_amount") or 0)
        print(f"Invoice na betaling: paid_amount={paid_after}, status={inv_after.get('status')}")

        # Assertie
        expected_delta = float(pending["amount"])
        actual_delta = round(paid_after - paid_before, 2)
        if abs(actual_delta - expected_delta) < 0.05:
            print(f"\n✓ PASS: invoice.paid_amount steeg met {actual_delta} (verwacht {expected_delta})")
            return 0
        print(f"\n✗ FAIL: invoice.paid_amount steeg met {actual_delta}, verwacht {expected_delta}")
        return 1


def Number(v):
    try: return float(v or 0)
    except (TypeError, ValueError): return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
