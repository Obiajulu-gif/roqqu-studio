"""Roqqu client: request shape, parsing, production guard, secret safety.

All hermetic: httpx MockTransport stands in for api.roqqu.com, so these run
with no network and no real credentials. Shapes follow developers.roqqu.com.
"""

from __future__ import annotations

import io
import json
from decimal import Decimal

import httpx
import pytest

from roqqu_studio.config import Settings
from roqqu_studio.integrations.roqqu import RoqquClient, RoqquError, ngn_to_token, usd_to_ngn
from roqqu_studio.integrations.roqqu import client as client_mod
from roqqu_studio.observability import configure_logging

SECRET = "RQ-SEC-TESTSECRET456"
ADDRESS = "TXYZmockAddress1234567890"


def _settings(**overrides) -> Settings:
    values = dict(
        _env_file=None,
        roqqu_secret_key=SECRET,
        allow_production_execution=True,  # Roqqu has no sandbox
        roqqu_ngn_per_usd="1500",
    )
    values.update(overrides)
    return Settings(**values)


def _ok(data=None) -> httpx.Response:
    return httpx.Response(200, json={"status": "success", "message": "ok", "data": data})


def _handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["Authorization"] == f"Bearer {SECRET}"
    path = request.url.path
    body = json.loads(request.content or b"{}")
    if path == "/prod/v1/user/generate-wallet":
        return _ok({"address": ADDRESS, "type": body["token"], "total_received": 0, "genesis": 0,
                    "created_at": "2026-10-21 10:00:00"})
    if path == "/prod/v1/user/wallets":
        return _ok([{"address": ADDRESS, "type": "trx", "total_received": 12.5,
                     "total_received_usdt": 3.25, "genesis": 1}])
    if path == "/prod/v1/user/send-trx":
        assert body == {"amount": 10.0, "wallet": "TDEST"}
        return httpx.Response(200, json={"status": "success", "message": "sent successfully"})
    if path == "/prod/v1/price":
        assert request.url.params["symbol"] == "trx"
        return _ok(0.25)
    if path == "/prod/v1/user/account-resolve":
        assert body == {"account_number": "3051559336", "bank": "First Bank of Nigeria Limited"}
        return _ok("ADA OKAFOR")
    return httpx.Response(404, json={"status": "fail", "message": f"no route {path}"})


def _client(handler=_handler, **overrides) -> RoqquClient:
    return RoqquClient(_settings(**overrides), transport=httpx.MockTransport(handler))


def test_generate_wallet_returns_the_new_address() -> None:
    with _client() as c:
        wallet = c.generate_wallet(token="TRX")
    assert wallet["address"] == ADDRESS
    assert wallet["token"] == "trx"


def test_wallet_tokens_are_limited_to_btc_eth_trx() -> None:
    with _client() as c, pytest.raises(RoqquError, match="btc, eth, trx"):
        c.generate_wallet(token="usdt")


def test_wallet_received_reads_get_wallets_for_that_address() -> None:
    with _client() as c:
        res = c.wallet_received(token="trx", address=ADDRESS)
    assert res == {"status": "PAID", "amount_token": "12.5", "amount_usd": "3.25"}


def test_unknown_address_is_an_error_not_a_payment() -> None:
    with _client() as c, pytest.raises(RoqquError, match="not one of this account"):
        c.wallet_received(token="trx", address="TSOMEONE_ELSE")


def test_send_token_posts_to_send_symbol() -> None:
    with _client() as c:
        res = c.send_token(token="trx", amount=Decimal("10"), wallet="TDEST")
    assert res["status"] == "sent"


def test_price_and_account_resolve() -> None:
    with _client() as c:
        assert c.token_price(symbol="TRX") == Decimal("0.25")
        name = c.account_resolve(account_number="3051559336", bank="First Bank of Nigeria Limited")
    assert name == "ADA OKAFOR"


def test_fail_envelope_and_http_errors_raise() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"status": "fail", "message": "invalid token supplied"})

    with _client(fail) as c, pytest.raises(RoqquError, match="invalid token supplied"):
        c.token_price(symbol="xyz")

    # The docs show some 400s carrying status "success": the HTTP code still wins.
    def lying(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"status": "success", "message": "unsupported token"})

    with _client(lying) as c, pytest.raises(RoqquError, match="unsupported token"):
        c.get_wallets(token="btc")


def test_address_lookup_never_exceeds_one_call_per_100s(monkeypatch) -> None:
    monkeypatch.setattr(client_mod, "_last_address_lookup", 0.0)

    def chain(request: httpx.Request) -> httpx.Response:
        return _ok({"address": ADDRESS, "balance": 1})

    with _client(chain) as c:
        assert c.blockchain_address(symbol="trx", address=ADDRESS)["balance"] == 1
        with pytest.raises(RoqquError, match="rate limited"):
            c.blockchain_address(symbol="trx", address=ADDRESS)


def test_production_is_refused_unless_explicitly_allowed() -> None:
    with pytest.raises(RoqquError, match="no sandbox"):
        RoqquClient(_settings(allow_production_execution=False))


def test_missing_keys_and_unreachable_host_are_roqqu_errors() -> None:
    # Keyless deploys must get a clean RoqquError (-> 502), never a raw 500.
    with pytest.raises(RoqquError, match="not configured"):
        RoqquClient(_settings(roqqu_secret_key=""))

    def _down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dns", request=request)

    with _client(_down) as c, pytest.raises(RoqquError, match="unreachable"):
        c.generate_wallet(token="trx")


def test_secret_never_appears_in_logs() -> None:
    buf = io.StringIO()
    configure_logging(stream=buf)
    with _client() as c:
        c.generate_wallet(token="trx")
    assert SECRET not in buf.getvalue()


def test_fx_helpers_are_exact() -> None:
    s = _settings()
    assert usd_to_ngn("3.25", s) == Decimal("4875.00")
    # NGN 1,500 = USD 1 = 4 TRX at USD 0.25
    assert ngn_to_token("1500", Decimal("0.25"), s) == Decimal("4.00000000")


def test_public_prices_caches_failures_so_a_down_api_is_not_hammered(monkeypatch) -> None:
    monkeypatch.setattr(client_mod, "_price_cache", {"at": 0.0, "data": None, "error": ""})
    calls = []

    def down(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(502, text="error code: 502")

    for _ in range(3):
        with pytest.raises(RoqquError, match="prices unavailable"):
            client_mod.public_prices("https://api.roqqu.com/prod/v1", transport=httpx.MockTransport(down))
    assert len(calls) == 1
