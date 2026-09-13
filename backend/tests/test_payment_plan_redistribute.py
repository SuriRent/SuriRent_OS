"""Regressietest voor auto-herverdeling in Betalingsregelingen.

Scenario: 3-termijn regeling (elk 1000, totaal 3000) op factuur 7000/4000.
- Termijn 1 (1000) betaald → factuur 5000 betaald, 2000 open.
- Extra 500 huur buiten regeling → factuur 5500 betaald, 1500 open.
- Herverdeling: 2 pending termijnen worden elk 750 (1500/2).
- Looptijd blijft 3 termijnen; plan.total_amount schuift naar 2500.
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
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}",
            "Content-Type": "application/json"}


def _reset_demo():
    # Verwijder alle bestaande regelingen van Roy zodat we schone state hebben
    # (zonder de hele demo-reset te forceren, want dat is niet HTTP-exposed).
    pass


def test_extra_payment_redistributes_pending_installments(demo_headers):
    # Zoek Roy
    tenants = requests.get(f"{API}/tenants", headers=demo_headers, timeout=15).json()
    roy = next((t for t in tenants if "Roy" in t.get("name", "")), None)
    assert roy, "Demo tenant Roy niet gevonden"
    # Zoek zijn factuur
    invs = requests.get(f"{API}/invoices", headers=demo_headers, timeout=15).json()
    inv = next((i for i in invs if i.get("tenant_id") == roy["id"]), None)
    assert inv, "Roy heeft geen factuur"

    # Verwijder eventueel bestaande actieve regelingen door annuleren
    existing = requests.get(f"{API}/payment-plans?status=active",
                            headers=demo_headers, timeout=15).json()
    for p in existing:
        if p["tenant_id"] == roy["id"]:
            requests.post(f"{API}/payment-plans/{p['id']}/cancel",
                          headers=demo_headers, timeout=15)

    # Nieuwe 3-termijn regeling (elk 1000)
    total_open = float(inv["amount"]) - float(inv.get("paid_amount") or 0)
    # Bouw met num_installments zodat we zeker 3 gelijke termijnen krijgen
    r = requests.post(f"{API}/payment-plans", headers=demo_headers,
                      json={"tenant_id": roy["id"],
                            "invoice_ids": [inv["id"]],
                            "total_amount": total_open,
                            "currency": inv.get("currency", "SRD"),
                            "num_installments": 3,
                            "start_date": "2026-10-01",
                            "frequency": "monthly"},
                      timeout=15)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert len(plan["installments"]) == 3

    per = round(total_open / 3, 2)

    # Termijn 1 betalen
    r1 = requests.post(f"{API}/payment-plans/{plan['id']}/installments/1/pay",
                       headers=demo_headers, json={"method": "contant"},
                       timeout=15)
    assert r1.status_code == 200, r1.text

    # Extra 500 huur buiten de regeling
    r2 = requests.post(f"{API}/payments", headers=demo_headers,
                       json={"tenant_id": roy["id"], "amount": 500,
                             "currency": "SRD", "category": "huur",
                             "method": "bank",
                             "note": "regression test redistribute"},
                       timeout=15)
    assert r2.status_code == 200, r2.text

    # Verify herverdeling
    r3 = requests.get(f"{API}/payment-plans/{plan['id']}",
                      headers=demo_headers, timeout=15)
    p = r3.json()
    # Looptijd blijft 3 termijnen (geen cancels)
    pending = [i for i in p["installments"] if i["status"] == "pending"]
    assert len(pending) == 2, p["installments"]
    # Beide pending termijnen zijn nu 500 lager per, evenredig verdeeld
    # over de 2. Origineel 2×1000 = 2000. Na −500 huur = 1500 → 2×750.
    expected_per = round((total_open - per - 500) / 2, 2)
    for i in pending:
        assert abs(i["amount"] - expected_per) < 0.02, (i, expected_per)
    # Plan-total is bijgesteld naar paid + resterend factuur
    assert abs(p["total_amount"] - (per + (total_open - per - 500))) < 0.05, p
