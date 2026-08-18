"""Iter 53 — regression for endpoints backing SWR refactor on
Payments/Invoices/Locations tabs. Verifies list endpoints return 200
and expected data shape; verifies /api/auth/login demo works."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://vastgoed-app.preview.emergentagent.com').rstrip('/')
DEMO_EMAIL = 'demo@surirent.sr'
DEMO_PASS = 'demo1234'


@pytest.fixture(scope='module')
def token():
    r = requests.post(f'{BASE_URL}/api/auth/login',
                      json={'email': DEMO_EMAIL, 'password': DEMO_PASS},
                      timeout=15)
    assert r.status_code == 200, f'login failed: {r.status_code} {r.text[:200]}'
    data = r.json()
    tk = data.get('access_token') or data.get('token')
    assert tk, f'no token in login response: {data}'
    return tk


@pytest.fixture(scope='module')
def headers(token):
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}


def test_login_demo_ok():
    r = requests.post(f'{BASE_URL}/api/auth/login',
                      json={'email': DEMO_EMAIL, 'password': DEMO_PASS},
                      timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get('access_token') or body.get('token')


def test_login_wrong_password_401():
    r = requests.post(f'{BASE_URL}/api/auth/login',
                      json={'email': DEMO_EMAIL, 'password': 'wrongpw'},
                      timeout=15)
    assert r.status_code in (401, 400, 403)


def test_get_payments(headers):
    r = requests.get(f'{BASE_URL}/api/payments', headers=headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_payments_pending(headers):
    r = requests.get(f'{BASE_URL}/api/payments?status=pending_approval', headers=headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_invoices(headers):
    r = requests.get(f'{BASE_URL}/api/invoices', headers=headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_locations(headers):
    r = requests.get(f'{BASE_URL}/api/locations', headers=headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_tenants(headers):
    r = requests.get(f'{BASE_URL}/api/tenants', headers=headers, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_tenants_credits(headers):
    r = requests.get(f'{BASE_URL}/api/tenants/credits', headers=headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    # Endpoint may return dict keyed by tenant_id
    assert isinstance(body, (dict, list))


def test_location_crud(headers):
    # CREATE
    payload = {'name': 'TEST_SWR_Loc_iter53', 'address': 'Testlaan 1'}
    r = requests.post(f'{BASE_URL}/api/locations', headers=headers, json=payload, timeout=15)
    assert r.status_code in (200, 201), f'create failed: {r.status_code} {r.text[:200]}'
    loc = r.json()
    assert loc.get('id')
    assert loc.get('name') == payload['name']
    lid = loc['id']
    # GET verify
    r = requests.get(f'{BASE_URL}/api/locations', headers=headers, timeout=15)
    assert r.status_code == 200
    names = [x.get('name') for x in r.json()]
    assert payload['name'] in names
    # DELETE
    r = requests.delete(f'{BASE_URL}/api/locations/{lid}', headers=headers, timeout=15)
    assert r.status_code in (200, 204)
    # Verify removed
    r = requests.get(f'{BASE_URL}/api/locations', headers=headers, timeout=15)
    ids = [x.get('id') for x in r.json()]
    assert lid not in ids
