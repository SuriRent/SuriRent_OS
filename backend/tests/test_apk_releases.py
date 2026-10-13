"""Backend tests for APK release upload/download endpoints."""
import os
import io
import random
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vastgoed-app.preview.emergentagent.com").rstrip("/")

SUPER = {"email": "super@surirent.sr", "password": "super1234"}
DEMO = {"email": "demo@surirent.sr", "password": "demo1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def super_session():
    return _login(SUPER)


@pytest.fixture(scope="module")
def demo_session():
    return _login(DEMO)


def _make_fake_apk(size_bytes: int) -> bytes:
    # starts with 'PK' magic; rest is pseudo-random
    body = bytearray(b"PK\x03\x04")
    body += bytes(random.getrandbits(8) for _ in range(size_bytes - 4))
    return bytes(body)


# ---------- Non-superadmin access ----------
def test_non_superadmin_forbidden_init(demo_session):
    r = demo_session.post(f"{BASE_URL}/api/superadmin/apk/upload/init",
                          json={"filename": "x.apk", "size": 100, "version": "9.9.9"})
    assert r.status_code == 403, r.text


def test_non_superadmin_forbidden_list(demo_session):
    r = demo_session.get(f"{BASE_URL}/api/superadmin/apk")
    assert r.status_code == 403


# ---------- Validation of /init ----------
def test_init_rejects_non_apk(super_session):
    r = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/init",
                           json={"filename": "evil.exe", "size": 1024, "version": "1.0.0"})
    assert r.status_code == 400


def test_init_rejects_missing_version(super_session):
    r = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/init",
                           json={"filename": "ok.apk", "size": 1024, "version": "   "})
    assert r.status_code == 400


def test_init_rejects_too_large(super_session):
    r = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/init",
                           json={"filename": "big.apk", "size": 400 * 1024 * 1024, "version": "1.0.0"})
    assert r.status_code == 400


# ---------- End-to-end upload + public download ----------
APK_SIZE = 5 * 1024 * 1024 + 1234  # ~5MB — will need 2 chunks at 4MB chunk_size
APK_BYTES = _make_fake_apk(APK_SIZE)


@pytest.fixture(scope="module")
def uploaded_release(super_session):
    # init
    r = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/init",
                           json={"filename": "test.apk", "size": APK_SIZE,
                                 "version": "9.9.9-test", "notes": "pytest release"})
    assert r.status_code == 200, r.text
    data = r.json()
    uid = data["upload_id"]
    chunk_size = data["chunk_size"]
    assert chunk_size == 4 * 1024 * 1024

    # upload chunks (raw octet-stream)
    idx = 0
    for off in range(0, APK_SIZE, chunk_size):
        chunk = APK_BYTES[off: off + chunk_size]
        cr = super_session.put(f"{BASE_URL}/api/superadmin/apk/upload/{uid}/chunk/{idx}",
                               data=chunk,
                               headers={"Content-Type": "application/octet-stream"})
        assert cr.status_code == 200, cr.text
        idx += 1

    # complete
    cr = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/{uid}/complete")
    assert cr.status_code == 200, cr.text
    rel = cr.json()
    assert rel["version"] == "9.9.9-test"
    assert rel["size"] == APK_SIZE
    assert "id" in rel
    yield rel
    # cleanup — soft delete
    super_session.delete(f"{BASE_URL}/api/superadmin/apk/{rel['id']}")


def test_list_contains_release(super_session, uploaded_release):
    r = super_session.get(f"{BASE_URL}/api/superadmin/apk")
    assert r.status_code == 200
    ids = [x["id"] for x in r.json()]
    assert uploaded_release["id"] in ids


def test_public_latest(uploaded_release):
    r = requests.get(f"{BASE_URL}/api/public/apk/latest", timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert data["available"] is True
    # newest should be our just-uploaded one
    assert data["release"]["id"] == uploaded_release["id"]
    assert data["release"]["version"] == "9.9.9-test"


def test_public_download_bytes_match(uploaded_release):
    pre = requests.get(f"{BASE_URL}/api/public/apk/latest", timeout=20).json()["release"]
    pre_dl = pre.get("downloads", 0)

    r = requests.get(f"{BASE_URL}/api/public/apk/download", timeout=60, stream=True)
    assert r.status_code == 200
    cd = r.headers.get("Content-Disposition", "")
    assert "SuriRent-9.9.9-test.apk" in cd, cd
    body = r.content
    assert len(body) == APK_SIZE
    assert body == APK_BYTES  # byte-identical

    # downloads counter increments
    post = requests.get(f"{BASE_URL}/api/public/apk/latest", timeout=20).json()["release"]
    assert post["downloads"] == pre_dl + 1


def test_delete_release(super_session, uploaded_release):
    # Upload a 2nd throwaway release so that after delete there's still one left (seeded v1.0.0 might exist)
    size = 4096
    data = _make_fake_apk(size)
    init = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/init",
                              json={"filename": "throwaway.apk", "size": size,
                                    "version": "0.0.1-trash", "notes": ""}).json()
    uid = init["upload_id"]
    super_session.put(f"{BASE_URL}/api/superadmin/apk/upload/{uid}/chunk/0",
                      data=data, headers={"Content-Type": "application/octet-stream"})
    comp = super_session.post(f"{BASE_URL}/api/superadmin/apk/upload/{uid}/complete").json()
    rid = comp["id"]

    # delete it
    dr = super_session.delete(f"{BASE_URL}/api/superadmin/apk/{rid}")
    assert dr.status_code == 200
    # not in list anymore
    lst = super_session.get(f"{BASE_URL}/api/superadmin/apk").json()
    assert rid not in [x["id"] for x in lst]
    # 404 on second delete
    dr2 = super_session.delete(f"{BASE_URL}/api/superadmin/apk/{rid}")
    assert dr2.status_code == 404
