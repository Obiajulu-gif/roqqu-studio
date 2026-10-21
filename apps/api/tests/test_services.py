"""Business service panels: practice mode works end to end with no keys,
inputs are checked like Roqqu checks them, KYC never leaks the full record."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from roqqu_studio import services
from roqqu_studio.api.main import app
from roqqu_studio.config import Settings

client = TestClient(app)

TRX = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
ETH = "0x" + "ab" * 20


def run(action, **params):
    return client.post("/services/run", json={"action": action, "params": params, "mode": "practice"})


def test_bills_flow_meter_then_units_then_airtime():
    meter = run("verify-meter", provider="ikeja", meter_type="prepaid", meter_number="45055844760")
    assert meter.status_code == 200 and "OKAFOR" in meter.json()["data"]["cust_name"]
    units = run("pay-electricity", provider="ikeja", meter_type="prepaid",
                meter_number="45055844760", amount=5000, phone_number="08031234567")
    data = units.json()["data"]
    assert units.json()["mode"] == "practice" and len(data["token"].split("-")) == 5
    assert data["fee_ngn"] == "100"
    assert run("recharge-airtime", phone_number="08031234567", amount=200).status_code == 200
    assert run("recharge-airtime", phone_number="123", amount=200).json()["detail"] == "invalid phone number supplied"


def test_data_plans_then_purchase():
    plans = run("data-bundles", provider="mtn").json()["data"]
    assert plans and plans[0]["variation_code"].startswith("mtn-")
    bought = run("buy-data", provider="mtn", variation_code=plans[1]["variation_code"],
                 phone_number="08031234567")
    assert bought.status_code == 200 and bought.json()["data"]["request_id"]


def test_withdrawal_checks_address_format():
    assert run("check-address", symbol="trx", addr=TRX).status_code == 200
    bad = run("check-address", symbol="eth", addr=TRX)
    assert bad.status_code == 400 and "invalid ETH address" in bad.json()["detail"]
    assert run("send-token", token="eth", amount="0.01", wallet=ETH).status_code == 200


def test_kyc_returns_name_and_masked_number_only():
    res = run("bvn-verify", bvn="22212345678").json()["data"]
    assert res == {"name": "ADA CHIOMA OKAFOR", "bvn": "••••••••678"}
    assert run("bvn-verify", bvn="123").status_code == 400
    banks = run("get-banks").json()["data"]
    resolved = run("account-resolve", account_number="0123456789", bank=banks[0])
    assert "OKAFOR" in resolved.json()["data"]


def test_payroll_pays_valid_rows_and_skips_bad_addresses():
    res = client.post("/services/payroll", json={
        "token": "trx", "mode": "practice",
        "rows": [{"name": "Ada", "wallet": TRX, "amount_ngn": 150000},
                 {"name": "Bayo", "wallet": "not-a-wallet", "amount_ngn": 90000}],
    }).json()
    assert [r["ok"] for r in res["results"]] == [True, False]
    # NGN 150,000 / 1,500 per USD / USD 0.25 per TRX (practice price) = 400 TRX
    assert res["results"][0]["amount_token"] == "400.00000000"


def test_alerts_fire_once_when_the_price_crosses():
    sym = client.post("/services/alerts", json={"symbol": "btc", "direction": "above", "price_usd": 60000})
    assert sym.status_code == 200
    board = client.get("/services/alerts").json()
    alert = next(a for a in board["alerts"] if a["id"] == sym.json()["id"])
    assert board["source"] in ("live", "practice") and alert["triggered_at"]
    client.delete(f"/services/alerts/{alert['id']}")
    assert all(a["id"] != alert["id"] for a in client.get("/services/alerts").json()["alerts"])


def test_history_records_every_action_for_the_panel():
    run("verify-meter", provider="ikeja", meter_type="prepaid", meter_number="45055844760")
    entries = client.get("/services/history", params={"panel": "bills"}).json()
    assert entries and entries[0]["mode"] == "practice" and entries[0]["panel"] == "bills"


def test_live_mode_respects_the_money_gate():
    with pytest.raises(services.ServiceError, match="no sandbox"):
        services.run(
            services.ServiceRequest(action="send-token", mode="live",
                                    params={"token": "trx", "amount": "1", "wallet": TRX}),
            Settings(_env_file=None, roqqu_secret_key="RQ-SEC-k"),
            "s",
        )


def test_unknown_action_is_404():
    assert run("drop-tables").status_code == 404
