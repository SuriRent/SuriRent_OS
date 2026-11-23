import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest


def test_superadmin_pin_configuration_requires_four_digits():
    import server

    assert server._validated_superadmin_pin(None) is None
    assert server._validated_superadmin_pin("  ") is None
    assert server._validated_superadmin_pin(" 4826 ") == "4826"

    for invalid in ("12", "abcd", "12345", "12a4"):
        with pytest.raises(RuntimeError, match="exactly four digits"):
            server._validated_superadmin_pin(invalid)


def test_bootstrap_superadmin_pin_hashes_pin_when_missing(monkeypatch):
    import server

    find_one = AsyncMock(return_value={})
    find = Mock(return_value=SimpleNamespace(to_list=AsyncMock(return_value=[])))
    update_one = AsyncMock(return_value=SimpleNamespace(modified_count=1))
    monkeypatch.setattr(server, "db", SimpleNamespace(users=SimpleNamespace(
        find_one=find_one, find=find, update_one=update_one,
    )))

    updated = asyncio.run(server._bootstrap_superadmin_pin("superadmin-1", "4826"))

    assert updated is True
    update_query, update = update_one.await_args.args
    pin_hash = update["$set"]["personal_pin_hash"]
    assert update_query["id"] == "superadmin-1"
    assert server.verify_password("4826", pin_hash)
    assert not server.verify_password("1111", pin_hash)


def test_bootstrap_does_not_replace_existing_pin(monkeypatch):
    import server

    find_one = AsyncMock(return_value={"personal_pin_hash": server.hash_password("4826")})
    find = Mock()
    update_one = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=SimpleNamespace(
        find_one=find_one, find=find, update_one=update_one,
    )))

    updated = asyncio.run(server._bootstrap_superadmin_pin("superadmin-1", "1357"))

    assert updated is False
    find.assert_not_called()
    update_one.assert_not_awaited()


def test_bootstrap_rejects_pin_already_used_by_another_superadmin(monkeypatch):
    import server

    find_one = AsyncMock(return_value={})
    find = Mock(return_value=SimpleNamespace(to_list=AsyncMock(return_value=[
        {"personal_pin_hash": server.hash_password("4826")},
    ])))
    update_one = AsyncMock()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=SimpleNamespace(
        find_one=find_one, find=find, update_one=update_one,
    )))

    with pytest.raises(RuntimeError, match="already assigned"):
        asyncio.run(server._bootstrap_superadmin_pin("superadmin-1", "4826"))
    update_one.assert_not_awaited()
