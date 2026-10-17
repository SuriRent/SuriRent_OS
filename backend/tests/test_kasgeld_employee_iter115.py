# Iter115: Kasgeld bon employee name — POST /kiosk/kasgeld?employee_id&employee_pin stores created_by(+_name); fallback without/wrong params
import pytest
import requests

BASE_URL = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def login():
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": "my-awesome-rentals-bv"})
    if r.status_code != 200:
        pytest.skip(f"kiosk login failed {r.status_code}")
    d = r.json()
    return {"Authorization": f"Bearer {d['token']}"}, d["employee"]


@pytest.fixture(scope="module")
def ah():
    r = requests.post(f"{API}/auth/login", json={"email": "demo@surirent.sr", "password": "demo1234"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def created(ah):
    ids = []
    yield ids
    for i in ids:
        requests.delete(f"{API}/kasgeld/{i}", headers=ah)


def _create(kh, created, params=None, desc="TEST_iter115 bon"):
    r = requests.post(f"{API}/kiosk/kasgeld", headers=kh, params=params or {},
                      json={"type": "out", "amount": 3.5, "currency": "SRD", "description": desc, "category": "schoonmaak"})
    assert r.status_code == 200, r.text
    d = r.json()
    created.append(d["id"])
    return d


def _medewerker_line(kh, eid):
    data = requests.get(f"{API}/kiosk/kasgeld/{eid}/print-data", headers=kh).json()
    return next((ln["text"] for ln in data["lines"] if "Medewerker" in ln["text"]), "")


# --- valid employee_id + PIN -> real name stored and printed
def test_with_valid_employee(login, created):
    kh, emp = login
    d = _create(kh, created, {"employee_id": emp["id"], "employee_pin": "4321"})
    assert d["created_by"] == emp["id"]
    assert d["created_by_name"] == "Anita Sewdas"
    line = _medewerker_line(kh, d["id"])
    print(line)
    assert "Anita" in line
    row = next(x for x in requests.get(f"{API}/kiosk/kasgeld", headers=kh).json() if x["id"] == d["id"])
    assert row["created_by_name"] == "Anita Sewdas"


# --- no params -> fallback
def test_without_employee(login, created):
    kh, _ = login
    d = _create(kh, created)
    assert d["created_by"] is None and d["created_by_name"] == "Kiosk medewerker"
    assert "Kiosk medewerker" in _medewerker_line(kh, d["id"])


# --- wrong PIN -> fallback, no error
def test_wrong_pin(login, created):
    kh, emp = login
    d = _create(kh, created, {"employee_id": emp["id"], "employee_pin": "0000"})
    assert d["created_by"] is None and d["created_by_name"] == "Kiosk medewerker"


# --- unknown employee id -> fallback
def test_unknown_employee(login, created):
    kh, _ = login
    d = _create(kh, created, {"employee_id": "nope", "employee_pin": "4321"})
    assert d["created_by_name"] == "Kiosk medewerker"


# --- id without pin -> fallback
def test_id_without_pin(login, created):
    kh, emp = login
    d = _create(kh, created, {"employee_id": emp["id"]})
    assert d["created_by_name"] == "Kiosk medewerker"
