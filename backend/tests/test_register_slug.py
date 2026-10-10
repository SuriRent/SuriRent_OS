"""Verify POST /api/auth/register requires slug and succeeds when slug supplied."""
import os, time, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")

def _ts():
    return str(int(time.time() * 1000))

def test_register_without_slug_returns_400():
    ts = _ts()
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "name": "Reg Test",
        "email": f"regtest+noslug{ts}@example.com",
        "password": "secret123",
        "company_name": f"Regtest NoSlug {ts}",
        "country": "NL",
        "plan": "starter",
    }, timeout=20)
    assert r.status_code == 400, r.text
    body = r.json()
    assert "Slug" in (body.get("detail") or "") and "verplicht" in body["detail"].lower(), body

def test_register_with_slug_succeeds_and_persists():
    ts = _ts()
    slug = f"regtest-{ts}"
    email = f"regtest+{ts}@example.com"
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "name": "Reg Test",
        "email": email,
        "password": "secret123",
        "company_name": f"Regtest {ts}",
        "slug": slug,
        "country": "NL",
        "plan": "starter",
    }, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("company", {}).get("slug") == slug, data
    assert data.get("user", {}).get("email") == email, data

    # Public endpoint should see slug as taken now
    avail = requests.get(f"{BASE_URL}/api/public/companies/{slug}/available", timeout=10)
    assert avail.status_code == 200
    assert avail.json().get("available") is False
