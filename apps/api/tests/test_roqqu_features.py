"""Roqqu ecosystem features: coin choice at checkout, live price card, templates."""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient

from roqqu_studio.analysis import analyze
from roqqu_studio.api import main as api_main
from roqqu_studio.config import Settings
from roqqu_studio.orders import orders_service
from roqqu_studio.providers import default_catalog
from roqqu_studio.templates import build_template, list_templates

client = TestClient(api_main.app)



class _FakeRoqqu:
    made: list[str] = []

    def __init__(self, settings):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def generate_wallet(self, *, network, customer=None):
        address = f"{network.upper()}-addr-{len(self.made)}"
        self.made.append(address)
        return {"address": address, "network": network}


def _invoice() -> tuple[str, str]:
    wf = client.post("/workflows/from-template/invoice").json()["workflow"]
    artifact_id = client.post(f"/workflows/{wf['id']}/generate", json={}).json()["artifact_id"]
    inv = client.post(
        f"/preview/{artifact_id}/invoices",
        json={"customer": "Ada", "description": "Logo design", "amount": 150000},
    ).json()
    return artifact_id, inv["reference"]


def test_buyer_picks_a_coin_and_can_switch(monkeypatch):
    monkeypatch.setattr(api_main, "RoqquClient", _FakeRoqqu)
    monkeypatch.setattr(api_main, "token_price_usd", lambda s, coin: Decimal("60000") if coin == "btc" else Decimal(1))
    monkeypatch.setattr(api_main.credential_store, "settings_for",
                        lambda _wid: Settings(_env_file=None, ras_test_key="ras_test_k_0123456789abcdef0123", roqqu_ngn_per_usd="1500"))
    artifact_id, ref = _invoice()

    res = client.post(f"/preview/{artifact_id}/invoice/{ref}/pay?token=btc")
    assert res.status_code == 200
    page = client.get(res.json()["checkout_url"]).text
    # NGN 150,000 / 1,500 = USD 100 = 0.00166667 BTC (rounded up)
    assert "0.00166667 BTC" in page and 'value="usdt_bep20"' in page

    switched = client.post(
        f"/preview/{artifact_id}/deposit/{ref}", data={"token": "usdt_bep20"}, follow_redirects=True
    )
    assert switched.status_code == 200
    assert "100.00000000 USDT (BEP20)" in switched.text
    order = orders_service.get(ref)
    assert order.transaction_reference.startswith("usdt_bep20:")
    assert order.payment_reference.startswith("BEP20-addr")


def test_unknown_coin_is_rejected(monkeypatch):
    monkeypatch.setattr(api_main, "RoqquClient", _FakeRoqqu)
    artifact_id, ref = _invoice()
    assert client.post(f"/preview/{artifact_id}/invoice/{ref}/pay?token=doge").status_code == 400


def test_verify_checks_the_coin_the_buyer_paid_in(monkeypatch):
    monkeypatch.setattr(api_main, "RoqquClient", _FakeRoqqu)
    artifact_id, ref = _invoice()
    client.post(f"/preview/{artifact_id}/invoice/{ref}/pay?token=usdt_bep20")
    seen = {}

    def verifier(payment_reference, workflow_id=None, token=None):
        seen["token"] = token
        return {"status": "PAID", "amount_paid": "150000"}

    original = orders_service.verifier
    orders_service.verifier = verifier
    try:
        assert orders_service.verify(ref).status.value == "verified"
    finally:
        orders_service.verifier = original
    assert seen["token"] == "usdt_bep20"


def test_price_card_needs_no_key(monkeypatch):
    monkeypatch.setattr(
        api_main, "public_prices",
        lambda base: {"btc": {"price": 60000, "change": 1.2}, "xrp": {"price": 0.5, "change": -2}},
    )
    monkeypatch.setattr(
        api_main.credential_store, "settings_for",
        lambda _wid: Settings(_env_file=None, roqqu_ngn_per_usd="1500"),
    )
    monkeypatch.setattr(api_main, "ngn_per_usd", lambda s: Decimal("1500"),
    )
    body = client.get("/roqqu/prices").json()
    btc = next(t for t in body["tokens"] if t["symbol"] == "btc")
    assert btc["price_ngn"] == "90000000.00" and btc["payable"] is True
    assert next(t for t in body["tokens"] if t["symbol"] == "xrp")["payable"] is False


ALL_TEMPLATES = ["sell-online", "invoice", "ajo", "payroll", "withdrawals", "price-alerts"]


def test_every_template_is_clean_and_runs_in_practice():
    from roqqu_studio.executor import run_workflow
    from roqqu_studio.executor.adapter import MockAdapter

    assert {t.id for t in list_templates()} == set(ALL_TEMPLATES)
    for template_id in ALL_TEMPLATES:
        wf = build_template(template_id)
        assert analyze(wf, default_catalog()).findings == [], template_id
        assert run_workflow(wf, adapter=MockAdapter()).status.value == "completed", template_id


def test_withdrawal_without_address_check_is_flagged():
    from roqqu_studio.ir.models import Edge

    wf = build_template("withdrawals")
    wf.nodes = [n for n in wf.nodes if n.id != "address"]
    wf.edges = [e for e in wf.edges if "address" not in (e.source, e.target)]
    wf.edges.append(Edge(source="once", target="balance"))
    rules = {f.rule_id for f in analyze(wf, default_catalog()).findings}
    assert "MON011" in rules


def test_rooky_keyword_routes_cover_the_new_templates():
    from roqqu_studio.ai.providers import KeywordFallback

    fb = KeywordFallback()
    cases = {
        "Let customers withdraw their crypto": "withdrawals",
        "Alert me when BTC crosses 70k": "price-alerts",
        "I sell thrift clothes on Instagram": "sell-online",
    }
    for message, expected in cases.items():
        assert fb.structured(system="", user="", message=message).template_id == expected, message



def test_live_balances_run_through_the_playground(monkeypatch):
    from roqqu_studio import playground
    from roqqu_studio.executor.adapter import SandboxAdapter
    from roqqu_studio.ir.models import Node

    seen = {}

    def fake_call(req, settings, transport=None):
        seen["endpoint"], seen["params"] = req.endpoint, req.params
        return {"status": 200, "elapsed_ms": 1,
                "request": {"method": "POST", "url": "u", "query": {}, "body": req.params},
                "response": {"status": "success", "data": {"balance": {"usdt": 137}}}}

    monkeypatch.setattr(playground, "call", fake_call)
    adapter = SandboxAdapter(Settings(_env_file=None, roqqu_secret_key="ras_test_x"))
    result = adapter.invoke(Node(id="b", type="roqqu.balances", config={"token": "usdt"}), {"inputs": {}})
    assert result.ok and seen == {"endpoint": "get-crypto-balances", "params": {"token": "usdt"}}
    assert result.outputs["data"]["balance"]["usdt"] == 137
