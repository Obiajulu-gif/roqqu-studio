"""RAS client: request shape, parsing, mode guard, webhook crypto, secret safety.

All hermetic: httpx MockTransport stands in for service.roqqu.com, so these run
with no network and no real credentials. Shapes follow
https://roqqu-api-services.gitbook.io/ras.
"""

from __future__ import annotations

import io
import time
from decimal import Decimal
from urllib.parse import parse_qs

import httpx
import pytest

from roqqu_studio.config import Settings
from roqqu_studio.integrations.roqqu import (
    RoqquClient,
    RoqquError,
    decrypt_webhook,
    encrypt_webhook,
    ngn_to_token,
    pay_option,
    usd_to_ngn,
)
from roqqu_studio.integrations.roqqu import client as client_mod
from roqqu_studio.observability import configure_logging

SECRET = "ras_test_TESTSECRET456_0123456789abcdef"
ADDRESS = "TXYZmockAddress1234567890"




def _settings(**overrides) -> Settings:
    values = dict(_env_file=None, ras_test_key=SECRET, roqqu_ngn_per_usd="1500")
    values.update(overrides)
    return Settings(**values)


def _ok(data=None) -> httpx.Response:
    return httpx.Response(200, json={"status": "success", "message": "ok", "data": data})


def _form(request: httpx.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


def _handler(request: httpx.Request) -> httpx.Response:
    assert request.headers["x-staging-api-key"] == SECRET  # test mode header
    path = request.url.path
    body = _form(request)
    if path == "/v1/wallets/generate-wallet":
        assert body["network"] == "trc20" and '"email"' in body["customer"]
        return _ok({"address": ADDRESS})
    if path == "/v1/wallets/generate-merchant-wallet":
        return _ok({"address": "MERCHANT" + body["network"]})
    if path == "/v1/wallets/get-addresses":
        return _ok([{"address": ADDRESS, "network": "trc20", "total_received": 12.5}])
    if path == "/v1/wallets/send":
        assert body == {"amount": "10", "network": "trc20", "to": "TDEST", "token": "usdt"}
        return _ok({"refid": "10704380386654367514"})
    if path == "/v1/wallets/what-network":
        if body["address"] == "nope":
            return httpx.Response(400, json={"status": "fail", "message": "cannot find any network for address parsed"})
        return _ok(["trc20"])
    if path == "/v1/payment-links":
        assert body["amount_currency"] == "ngn" and body["payment_reference"] == "ORDER1"
        assert '"network": "bep20"' in body["wallets"]
        return _ok({"refid": "abc", "payment_link": "https://payment.roqqu.com/abc", "wallets": []})
    return httpx.Response(404, json={"status": "fail", "message": f"no route {path}"})


def _client(handler=_handler, **overrides) -> RoqquClient:
    return RoqquClient(_settings(**overrides), transport=httpx.MockTransport(handler))


def test_generate_wallet_for_a_customer_and_for_the_merchant() -> None:
    customer = {"email": "a@b.co", "first_name": "Ada", "last_name": "Obi"}
    with _client() as c:
        assert c.generate_wallet(network="trc20", customer=customer)["address"] == ADDRESS
        assert c.generate_wallet(network="bep20")["address"] == "MERCHANTbep20"


def test_pay_options_map_to_ras_networks() -> None:
    assert pay_option("usdt_bep20") == ("bep20", "usdt")
    assert pay_option("btc") == ("bitcoin", "btc")
    assert pay_option("trx") == ("trc20", "usdt")  # older configs keep working
    with pytest.raises(RoqquError, match="pay with one of"):
        pay_option("doge")


def test_wallet_received_reads_get_addresses_for_that_address() -> None:
    with _client() as c:
        assert c.wallet_received(network="trc20", address=ADDRESS) == {"status": "PAID", "amount_token": "12.5"}


def test_unknown_address_is_an_error_not_a_payment() -> None:
    with _client() as c, pytest.raises(RoqquError, match="not one of this account"):
        c.wallet_received(network="trc20", address="TSOMEONE_ELSE")


def test_send_is_form_encoded_and_returns_the_refid() -> None:
    with _client() as c:
        res = c.send(token="usdt", network="trc20", to="TDEST", amount=Decimal("10"))
    assert res["refid"] == "10704380386654367514" and res["status"] == "queued"


def test_what_network_treats_unknown_addresses_as_empty() -> None:
    with _client() as c:
        assert c.what_network(address=ADDRESS) == ["trc20"]
        assert c.what_network(address="nope") == []


def test_payment_link_is_priced_in_naira_with_all_pay_options() -> None:
    with _client() as c:
        link = c.create_payment_link(
            amount_ngn=Decimal("5000"), reference="ORDER1",
            customer={"email": "a@b.co", "first_name": "Ada", "last_name": "Obi"},
            success_url="https://x.test/ok", cancel_url="https://x.test/no",
        )
    assert link["payment_link"] == "https://payment.roqqu.com/abc"


def test_fail_envelope_and_http_errors_raise() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"status": "fail", "message": "unsupported network"})

    with _client(fail) as c, pytest.raises(RoqquError, match="unsupported network"):
        c.generate_wallet(network="nope")

    def lying(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"status": "success", "message": "Invalid API Key"})

    with _client(lying) as c, pytest.raises(RoqquError, match="Invalid API Key"):
        c.get_addresses(network="trc20")


def test_live_mode_is_refused_unless_explicitly_allowed() -> None:
    with pytest.raises(RoqquError, match="real crypto"):
        RoqquClient(_settings(ras_test_key="", ras_live_key=SECRET))
    live = _settings(ras_test_key="", ras_live_key=SECRET, allow_production_execution=True)
    assert live.ras_mode == "live" and live.ras_key_header == "x-api-key"


def test_missing_keys_and_unreachable_host_are_roqqu_errors() -> None:
    with pytest.raises(RoqquError, match="not configured"):
        RoqquClient(_settings(ras_test_key=""))

    def _down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("dns", request=request)

    with _client(_down) as c, pytest.raises(RoqquError, match="unreachable"):
        c.generate_wallet(network="trc20")


def test_secret_never_appears_in_logs() -> None:
    buf = io.StringIO()
    configure_logging(stream=buf)
    with _client() as c:
        c.generate_wallet(network="bep20")
    assert SECRET not in buf.getvalue()


def test_webhook_round_trip_and_forgery() -> None:
    event = {"event_id": "1", "event_type": "token_received", "meta_data": {"address": ADDRESS, "value": 2}}
    body, iv = encrypt_webhook(event, SECRET)
    assert decrypt_webhook(body, iv, SECRET) == event
    assert decrypt_webhook(body, iv, "someone_elses_key_0123456789abcdef") is None
    assert decrypt_webhook({"hash": "zz"}, iv, SECRET) is None


def test_fx_helpers_are_exact() -> None:
    s = _settings()
    assert usd_to_ngn("3.25", s) == Decimal("4875.00")
    # NGN 1,500 = USD 1 = 4 TRX at USD 0.25
    assert ngn_to_token("1500", Decimal("0.25"), s) == Decimal("4.00000000")


def test_live_ngn_rate_comes_from_ras_rates(monkeypatch) -> None:
    monkeypatch.setattr(client_mod, "_cache", {})

    def rates(request: httpx.Request) -> httpx.Response:
        return _ok([{"symbol": "usd", "rate": 1}, {"symbol": "ngn", "rate": 1358}])

    assert client_mod.ngn_per_usd(_settings(), transport=httpx.MockTransport(rates)) == Decimal("1358")


def test_public_prices_caches_failures_so_a_down_api_is_not_hammered(monkeypatch) -> None:
    monkeypatch.setattr(client_mod, "_cache", {})
    calls = []

    def down(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(502, text="error code: 502")

    for _ in range(3):
        with pytest.raises(RoqquError, match="unavailable"):
            client_mod.public_prices("https://service.roqqu.com/v1", transport=httpx.MockTransport(down))
    assert len(calls) == 1
