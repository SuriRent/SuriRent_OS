import base64
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

import push_service
from push_service import PushResult


def _encoded_private_key():
    private_key = ec.generate_private_key(ec.SECP256R1())
    pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return base64.b64encode(pem).decode("ascii")


def test_vapid_public_key_is_derived_from_private_key(monkeypatch):
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_PEM_B64", _encoded_private_key())
    monkeypatch.setattr(push_service, "VAPID_PUBLIC_KEY", "")

    public_key = push_service.get_vapid_public_key()

    assert public_key.startswith("B")
    assert len(base64.urlsafe_b64decode(public_key + "=" * (-len(public_key) % 4))) == 65


def test_vapid_public_key_rejects_mismatched_configured_value(monkeypatch):
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_PEM_B64", _encoded_private_key())
    monkeypatch.setattr(push_service, "VAPID_PUBLIC_KEY", "B" + "A" * 86)

    with pytest.raises(ValueError, match="does not match"):
        push_service.get_vapid_public_key()


def test_vapid_public_key_requires_private_key(monkeypatch):
    monkeypatch.setattr(push_service, "VAPID_PRIVATE_PEM_B64", "")
    monkeypatch.setattr(push_service, "VAPID_PUBLIC_KEY", "")

    assert push_service.get_vapid_public_key() == ""


@pytest.mark.parametrize(
    ("status", "expected"),
    [(410, PushResult.EXPIRED), (503, PushResult.FAILED)],
)
def test_send_push_only_marks_gone_endpoints_expired(monkeypatch, status, expected):
    class FakeWebPushException(Exception):
        response = SimpleNamespace(status_code=status)

    def fail_push(**_kwargs):
        raise FakeWebPushException("provider error")

    monkeypatch.setattr(push_service, "WebPushException", FakeWebPushException)
    monkeypatch.setattr(push_service, "_get_vapid", lambda: object())
    monkeypatch.setattr(push_service, "webpush", fail_push)

    result = push_service.send_push(
        {"endpoint": "https://push.example/subscription", "keys": {}},
        "Test",
        "Testmelding",
    )

    assert result is expected
