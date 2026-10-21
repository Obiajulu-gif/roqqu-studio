"""Roqqu ecosystem features: coin choice at checkout, live price card, bills template."""

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

_PRICES = {"btc": Decimal("60000"), "eth": Decimal("3000"), "trx": Decimal("0.25")}


class _FakeRoqqu:
    made: list[str] = []

    def __init__(self, settings):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def generate_wallet(self, *, token):
        address = f"{token.upper()}-addr-{len(self.made)}"
        self.made.append(address)
        return {"address": address, "token": token, "total_received": "0", "created_at": ""}

    def token_price(self, *, symbol):
        return _PRICES[symbol]


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
    artifact_id, ref = _invoice()

    res = client.post(f"/preview/{artifact_id}/invoice/{ref}/pay?token=btc")
    assert res.status_code == 200
    page = client.get(res.json()["checkout_url"]).text
    # NGN 150,000 / 1,500 = USD 100 = 0.00166667 BTC (rounded up)
    assert "0.00166667 BTC" in page and 'value="eth"' in page

    switched = client.post(
        f"/preview/{artifact_id}/deposit/{ref}", data={"token": "eth"}, follow_redirects=True
    )
    assert switched.status_code == 200
    assert "0.03333334 ETH" in switched.text
    order = orders_service.get(ref)
    assert order.transaction_reference.startswith("eth:")
    assert order.payment_reference.startswith("ETH-addr")


def test_unknown_coin_is_rejected(monkeypatch):
    monkeypatch.setattr(api_main, "RoqquClient", _FakeRoqqu)
    artifact_id, ref = _invoice()
    assert client.post(f"/preview/{artifact_id}/invoice/{ref}/pay?token=doge").status_code == 400


def test_verify_checks_the_coin_the_buyer_paid_in(monkeypatch):
    monkeypatch.setattr(api_main, "RoqquClient", _FakeRoqqu)
    artifact_id, ref = _invoice()
    client.post(f"/preview/{artifact_id}/invoice/{ref}/pay?token=eth")
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
    assert seen["token"] == "eth"


def test_price_card_needs_no_key(monkeypatch):
    monkeypatch.setattr(
        api_main, "public_prices",
        lambda base: {"btc": {"price": 60000, "change": 1.2}, "xrp": {"price": 0.5, "change": -2}},
    )
    monkeypatch.setattr(
        api_main.credential_store, "settings_for",
        lambda _wid: Settings(_env_file=None, roqqu_ngn_per_usd="1500"),
    )
    body = client.get("/roqqu/prices").json()
    btc = next(t for t in body["tokens"] if t["symbol"] == "btc")
    assert btc["price_ngn"] == "90000000.00" and btc["payable"] is True
    assert next(t for t in body["tokens"] if t["symbol"] == "xrp")["payable"] is False


def test_bills_template_is_listed_and_clean():
    assert "pay-bills" in {t.id for t in list_templates()}
    report = analyze(build_template("pay-bills"), default_catalog())
    assert report.findings == []


def test_bills_template_runs_in_practice():
    wf = client.post("/workflows/from-template/pay-bills").json()["workflow"]
    run = client.post("/executions", json={"workflow": wf, "adapter": "mock"}).json()["run"]
    assert run["status"] == "completed"


def test_live_meter_check_returns_the_customer_name(monkeypatch):
    from roqqu_studio.executor.adapter import SandboxAdapter
    from roqqu_studio.ir.models import Node

    class Fake:
        def verify_meter(self, *, provider, meter_type, meter_number):
            assert (provider, meter_type, meter_number) == ("ikeja", "prepaid", "45055844760")
            return {"cust_name": "MR BETHEL LAWSON", "address": "x"}

    adapter = SandboxAdapter(Settings(_env_file=None, roqqu_secret_key="RQ-SEC-x"))
    monkeypatch.setattr(adapter, "_c", lambda: Fake())
    result = adapter.invoke(
        Node(id="m", type="roqqu.verify_meter", config={"meter_number": "45055844760"}),
        {"inputs": {}},
    )
    assert result.ok and result.outputs["account_name"] == "MR BETHEL LAWSON"
