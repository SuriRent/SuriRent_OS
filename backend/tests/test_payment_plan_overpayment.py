"""Regressietest voor de "Bijstelling" flow in Betalingsregelingen.

Scenario (uit user-bug rapport):
  - Factuur heeft SRD 7.000 open, SRD 4.000 al betaald.
  - Regeling met 2 termijnen van SRD 1.500 (totaal 3.000) is gekoppeld.
  - Termijn 1 wordt gemarkeerd als betaald → factuur op SRD 5.500 betaald.
  - Extra huur-betaling van SRD 500 wordt buiten de regeling om ingeboekt →
    factuur op SRD 6.000, open = SRD 1.000.
  - Voor de fix: regeling toonde nog SRD 1.500 resterend → over-betaling.
  - Na de fix: regeling toont SRD 1.000 resterend, next_due_amount=1000,
    overpayment_adjustment=True. Termijn 2 markeren betaald wordt gecapd
    op 1.000 en de regeling wordt automatisch afgesloten (completed).
"""
import os
from pathlib import Path

import pytest
import requests

DEMO_EMAIL = "demo@surirent.sr"
DEMO_PASSWORD = "demo1234"


def _base_url() -> str:
    url = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not url:
        env_path = Path("/app/frontend/.env")
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                url = line.split("=", 1)[1].strip()
                break
    return url.rstrip("/")


API = f"{_base_url()}/api"


@pytest.fixture(scope="module")
def demo_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}",
            "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def roy_and_plan(demo_headers):
    # Locate Roy tenant + zijn actieve regeling
    tenants = requests.get(f"{API}/tenants", headers=demo_headers, timeout=15).json()
    roy = next((t for t in tenants if "Roy" in t.get("name", "")), None)
    assert roy, "Demo tenant Roy niet gevonden — is _seed_demo_data uitgevoerd?"
    plans = requests.get(f"{API}/payment-plans?status=active",
                         headers=demo_headers, timeout=15).json()
    plan = next((p for p in plans if p["tenant_id"] == roy["id"]), None)
    assert plan, "Demo regeling voor Roy niet gevonden"
    return roy, plan


def test_overpayment_adjustment_caps_remaining(demo_headers, roy_and_plan):
    """De regeling capt het resterend bedrag aan wat er nog echt open staat
    op de gekoppelde factuur, wanneer buiten de regeling om al is bijbetaald.
    """
    roy, plan = roy_and_plan
    # Stap 1 — Termijn 1 (1500) markeren als betaald.
    # De regeling kan al gedeeltelijk betaald zijn door eerdere tests; sla
    # dan gewoon deze stap over.
    if plan["installments"][0]["status"] == "pending":
        r1 = requests.post(
            f"{API}/payment-plans/{plan['id']}/installments/1/pay",
            headers=demo_headers, json={"method": "contant"}, timeout=15,
        )
        assert r1.status_code == 200, r1.text

    # Stap 2 — Extra huur-betaling van 500 buiten de regeling om.
    r2 = requests.post(
        f"{API}/payments",
        headers=demo_headers,
        json={"tenant_id": roy["id"], "amount": 500, "currency": "SRD",
              "category": "huur", "method": "bank", "note": "regression test"},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text

    # Stap 3 — Regeling moet nu gecapte remaining tonen.
    r3 = requests.get(f"{API}/payment-plans/{plan['id']}",
                      headers=demo_headers, timeout=15)
    assert r3.status_code == 200, r3.text
    p = r3.json()
    assert p["overpayment_adjustment"] is True, p
    # De volgende termijn is 1500 gepland maar mag nooit meer dan het open
    # factuurbedrag zijn.
    assert p["next_due_amount"] <= p["linked_invoice_open"] + 0.01, p
    assert p["remaining_amount"] <= p["linked_invoice_open"] + 0.01, p

    # Stap 4 — Termijn 2 betalen wordt gecapd; plan wordt "completed".
    seq = next(i["sequence"] for i in p["installments"] if i["status"] == "pending")
    expected_cap = p["next_due_amount"]
    r4 = requests.post(
        f"{API}/payment-plans/{p['id']}/installments/{seq}/pay",
        headers=demo_headers, json={"method": "contant"}, timeout=15,
    )
    assert r4.status_code == 200, r4.text
    final = r4.json()
    assert final["status"] == "completed", final
    paid_seq = next(i for i in final["installments"] if i["sequence"] == seq)
    assert abs(paid_seq["amount"] - expected_cap) < 0.02, paid_seq
