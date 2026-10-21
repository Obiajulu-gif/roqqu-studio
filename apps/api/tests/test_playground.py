"""Roqqu API playground: full doc coverage, safe proxying, honest gating."""

from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from roqqu_studio import playground
from roqqu_studio.api.main import app
from roqqu_studio.config import Settings
from roqqu_studio.integrations.roqqu import client as client_mod

client = TestClient(app)

# Every endpoint in the API reference at developers.roqqu.com/llms.txt.
DOC_PATHS = {
    "/prices", "/price", "/history", "/blockchain/address", "/user/generate-wallet",
    "/user/wallets", "/user/delete-wallet", "/user/send-{token}", "/user/bvn-verify", "/banks",
    "/user/account-resolve", "/user/nin-verify", "/user/recharge-airtime",
    "/data/subscriptions", "/user/pay-data", "/cable/subscriptions", "/verify-iuc",
    "/verify-meter", "/user/pay-electric",
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
            "body": json.loads(request.content or b"{}"),
            "auth": request.headers.get("Authorization", ""),
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
    assert body["webhook"]["payload"]["secret"]
    assert all(e["doc_url"].startswith("https://developers.roqqu.com/reference/") for e in body["endpoints"])


def test_public_read_needs_no_key_and_builds_the_query():
    out = _call("get-price", {"symbol": "btc"})
    seen = out["response"]["seen"]
    assert seen["method"] == "GET" and seen["path"] == "/prod/v1/price"
    assert seen["query"] == {"symbol": "btc"} and seen["auth"] == ""


def test_authorised_read_sends_the_bearer_key():
    out = _call("get-wallets", {"token": "trx"}, roqqu_secret_key="RQ-SEC-k")
    assert out["response"]["seen"]["auth"] == "Bearer RQ-SEC-k"
    assert out["response"]["seen"]["body"] == {"token": "trx"}


def test_authorised_read_without_key_is_refused():
    with pytest.raises(playground.PlaygroundError, match="secret key"):
        _call("get-wallets", {"token": "trx"})


def test_money_moving_calls_need_explicit_production_opt_in():
    params = {"token": "trx", "amount": "10", "wallet": "TDEST"}
    with pytest.raises(playground.PlaygroundError, match="no sandbox"):
        _call("send-token", params, roqqu_secret_key="RQ-SEC-k")
    out = _call("send-token", params, roqqu_secret_key="RQ-SEC-k", allow_production_execution=True)
    seen = out["response"]["seen"]
    assert seen["path"] == "/prod/v1/user/send-trx"
    assert seen["body"] == {"amount": 10.0, "wallet": "TDEST"}  # optional memo/tag dropped


def test_path_token_cannot_escape_the_path():
    with pytest.raises(playground.PlaygroundError, match="coin symbol"):
        _call("send-token", {"token": "../banks", "amount": 1, "wallet": "x"},
              roqqu_secret_key="k", allow_production_execution=True)


def test_unknown_endpoint_and_missing_required_param():
    with pytest.raises(playground.PlaygroundError, match="unknown endpoint"):
        _call("drop-tables", {})
    with pytest.raises(playground.PlaygroundError, match="symbol is required"):
        _call("get-price", {})


def test_address_lookup_shares_the_rate_limit(monkeypatch):
    monkeypatch.setattr(client_mod, "_last_address_lookup", 0.0)
    _call("address-lookup", {"symbol": "btc", "addr": "3EEh"})
    with pytest.raises(playground.PlaygroundError, match="rate limited"):
        _call("address-lookup", {"symbol": "btc", "addr": "3EEh"})


def test_http_route_maps_errors_to_status_codes():
    res = client.post("/playground/call", json={"endpoint": "drop-tables", "params": {}})
    assert res.status_code == 404
