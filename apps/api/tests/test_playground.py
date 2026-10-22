"""RAS playground: full doc coverage, safe proxying, honest gating."""

from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from roqqu_studio import playground
from roqqu_studio.api.main import app
from roqqu_studio.config import Settings

client = TestClient(app)
KEY = "ras_test_k_0123456789abcdef0123456789"

# Every endpoint page in https://roqqu-api-services.gitbook.io/ras/llms.txt.
DOC_PATHS = {
    "/wallets/delete", "/wallets/generate-wallet", "/wallets/generate-merchant-wallet",
    "/wallets/get-network", "/wallets/get-addresses", "/wallets/get-all-networks",
    "/wallets/get-wallet", "/wallets/send", "/wallets/what-network", "/payment-links",
    "/payment-links/supported-networks", "/balances", "/trade/buy", "/tokens", "/trade/sell",
    "/trade/swap", "/transaction/network-fee", "/transaction/fee", "/transaction/status/{tx_hash}",
    "/transaction/deposit/{tx_hash}", "/transaction/refId/{refid}", "/transaction/refund",
    "/transaction/requery/{network}", "/transaction/search-blockchain-txhash",
    "/transaction/token-deposit", "/transaction/token-withdrawal", "/history", "/prices", "/rates",
    "/customers/blacklist", "/customers", "/customers/whitelist", "/ip", "/webhooks",
    "/webhooks/retrigger", "/analytics/stats", "/analytics/volume", "/analytics/wallet-generation",
    "/analytics/wallet-stats",
}


def _settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def _echo(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={
        "status": "success",
        "seen": {
            "method": request.method,
            "path": request.url.path,
            "query": dict(request.url.params),
            "body": {k: v[0] for k, v in parse_qs(request.content.decode()).items()},
            "test_key": request.headers.get("x-staging-api-key", ""),
            "live_key": request.headers.get("x-api-key", ""),
        },
    })


def _call(endpoint, params, **settings):
    return playground.call(
        playground.PlaygroundCall(endpoint=endpoint, params=params),
        _settings(**settings),
        transport=httpx.MockTransport(_echo),
    )


def test_catalog_covers_every_documented_endpoint():
    body = client.get("/playground/endpoints").json()
    assert {e["path"] for e in body["endpoints"]} == DOC_PATHS
    assert body["base_url"] == "https://service.roqqu.com/v1"
    assert body["webhook"]["payload"]["event_type"] == "token_received"
    assert all(e["doc_url"].startswith("https://roqqu-api-services.gitbook.io/ras/") for e in body["endpoints"])


def test_public_read_needs_no_key():
    seen = _call("get-crypto-prices", {})["response"]["seen"]
    assert seen["method"] == "GET" and seen["path"] == "/v1/prices"
    assert seen["test_key"] == "" and seen["live_key"] == ""


def test_test_key_rides_in_the_staging_header_as_form_data():
    seen = _call("get-addresses", {"network": "trc20"}, ras_test_key=KEY)["response"]["seen"]
    assert seen["test_key"] == KEY and seen["live_key"] == ""
    assert seen["body"] == {"network": "trc20"}


def test_authorised_call_without_key_is_refused():
    with pytest.raises(playground.PlaygroundError, match="RAS key"):
        _call("get-addresses", {"network": "trc20"})


def test_live_money_moves_need_explicit_opt_in_but_test_mode_does_not():
    params = {"amount": "2", "network": "trc20", "to": "TDEST", "token": "usdt"}
    seen = _call("send-coin", params, ras_test_key=KEY)["response"]["seen"]  # test mode: fine
    assert seen["path"] == "/v1/wallets/send" and seen["body"] == params
    with pytest.raises(playground.PlaygroundError, match="LIVE mode"):
        _call("send-coin", params, ras_live_key=KEY)
    seen = _call("send-coin", params, ras_live_key=KEY, allow_production_execution=True)["response"]["seen"]
    assert seen["live_key"] == KEY


def test_path_values_cannot_escape_the_path():
    seen = _call("get-transaction-status-by-transaction-hash", {"tx_hash": "0xabc123"}, ras_test_key=KEY)
    assert seen["response"]["seen"]["path"] == "/v1/transaction/status/0xabc123"
    with pytest.raises(playground.PlaygroundError, match="letters, numbers"):
        _call("get-transaction-status-by-transaction-hash", {"tx_hash": "../prices"}, ras_test_key=KEY)


def test_unknown_endpoint_and_missing_required_param():
    with pytest.raises(playground.PlaygroundError, match="unknown endpoint"):
        _call("drop-tables", {})
    with pytest.raises(playground.PlaygroundError, match="network is required"):
        _call("get-addresses", {}, ras_test_key=KEY)


def test_http_route_maps_errors_to_status_codes():
    res = client.post("/playground/call", json={"endpoint": "drop-tables", "params": {}})
    assert res.status_code == 404
