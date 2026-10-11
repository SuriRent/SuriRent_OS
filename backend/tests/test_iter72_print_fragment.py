"""Iteration 72 — verify /api/payments/{id}/print.html fragment/thermal/a4 behavior.

Fragment response must contain:
  * a <style> block
  * all CSS rules scoped under '#bon'
  * a <div class="sheet">

thermal preview and a4 formats must still return HTTP 200 full HTML.
"""
import os
import re
import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
COMPANY_SLUG = "my-awesome-rentals-bv"
PIN = "4321"


@pytest.fixture(scope="module")
def kiosk_token():
    r = requests.post(f"{BASE}/api/auth/kiosk-pin",
                      json={"pin": PIN, "company_slug": COMPANY_SLUG}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "demo@surirent.sr", "password": "demo1234"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def payment_id(admin_token):
    h = {"Authorization": f"Bearer {admin_token}"}
    # Grab a recent payment id from history
    r = requests.get(f"{BASE}/api/payments?limit=5", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows, "need at least one payment in history for fragment tests"
    return rows[0]["id"]


def test_fragment_html_structure(admin_token, payment_id):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE}/api/payments/{payment_id}/print.html?fragment=1",
                     headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.text
    # fragment: must NOT be a full HTML document
    assert "<!doctype" not in body.lower(), "fragment should not be full doc"
    assert "<html" not in body.lower(), "fragment should not include <html>"
    # must have <style> and <div class="sheet">
    assert "<style>" in body
    assert 'class="sheet"' in body
    # extract style content
    m = re.search(r"<style>(.*?)</style>", body, re.S)
    assert m, "no <style> block in fragment"
    css = m.group(1)
    # Every rule must be scoped under '#bon'. Simple heuristic: every selector
    # line should contain '#bon'. We parse rules by splitting on '}'.
    rules = [r.strip() for r in css.split("}") if r.strip() and "{" in r]
    for rule in rules:
        sel = rule.split("{")[0].strip()
        # ignore empty selectors / @-at-rules without braces here
        if sel.startswith("@"):
            continue
        assert "#bon" in sel, f"CSS rule not scoped under #bon: {sel!r}"


def test_thermal_preview_full_html(admin_token, payment_id):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE}/api/payments/{payment_id}/print.html?format=thermal&preview=1",
                     headers=h, timeout=15)
    assert r.status_code == 200
    assert "<!doctype" in r.text.lower() or "<html" in r.text.lower()
    assert 'class="sheet"' in r.text


def test_a4_format(admin_token, payment_id):
    h = {"Authorization": f"Bearer {admin_token}"}
    r = requests.get(f"{BASE}/api/payments/{payment_id}/print.html?format=a4",
                     headers=h, timeout=15)
    assert r.status_code == 200
    assert "<!doctype" in r.text.lower() or "<html" in r.text.lower()
