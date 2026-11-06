import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest

os.environ.setdefault("JWT_SECRET", "test-session-persistence-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from auth_utils import ACCESS_MIN, KIOSK_TOKEN_MIN, create_token, decode_token


def test_admin_and_kiosk_sessions_have_no_token_expiry():
    assert ACCESS_MIN is None
    assert KIOSK_TOKEN_MIN is None
    for token_type, ttl in (("access", ACCESS_MIN), ("kiosk", KIOSK_TOKEN_MIN)):
        claims = decode_token(create_token({"sub": "user-1", "type": token_type}, ttl))
        assert "exp" not in claims


def test_previously_issued_expired_access_token_can_still_be_decoded():
    token = jwt.encode(
        {
            "sub": "user-1",
            "type": "access",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        os.environ["JWT_SECRET"],
        algorithm="HS256",
    )
    assert decode_token(token, verify_exp=False)["sub"] == "user-1"


def test_explicitly_timed_tokens_still_expire():
    token = create_token({"sub": "support-user", "type": "access", "original_user_id": "admin-1"}, -1)
    with pytest.raises(jwt.ExpiredSignatureError):
        decode_token(token)
