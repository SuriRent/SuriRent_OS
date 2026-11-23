import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routes import _deps

_deps.get_current_user = lambda: {}
_deps.get_kiosk_session = lambda: {}
_deps.get_tenant_session = lambda: {}

from routes.company_mope import _amount_to_cents


@pytest.mark.parametrize(
    ("amount", "expected"),
    [(1, 100), (12.34, 1234), (0.01, 1)],
)
def test_mope_amount_uses_integer_cents(amount, expected):
    assert _amount_to_cents(amount) == expected


@pytest.mark.parametrize("amount", [0, -1, 1.005, float("nan"), float("inf")])
def test_mope_amount_rejects_invalid_precision_or_value(amount):
    with pytest.raises(HTTPException) as raised:
        _amount_to_cents(amount)
    assert raised.value.status_code == 400
