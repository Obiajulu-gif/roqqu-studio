"""Business service panels: practice mode works end to end with no keys, and
inputs are checked the way RAS checks them."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from roqqu_studio import services
from roqqu_studio.api.main import app
from roqqu_studio.config import Settings

client = TestClient(app)

TRX = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE"
BEP20 = "0x" + "ab" * 20


def run(action, **params):
    return client.post("/services/run", json={"action": action, "params": params, "mode": "practice"})


def test_withdrawal_checks_the_address_network_then_sends():
    assert run("check-address", address=TRX).json()["data"] == ["trc20"]
    assert run("check-address", address="nope").json()["detail"] == "cannot find any network for address parsed"
    sent = run("send-coin", token="usdt", network="bep20", amount="5", to=BEP20)
    assert sent.status_code == 200 and sent.json()["data"]["refid"]
    wrong = run("send-coin", token="usdt", network="trc20", amount="5", to=BEP20)
    assert wrong.json()["detail"] == "invalid network parsed for address"


def test_fee_and_balances_answer_in_ras_shape():
    assert run("network-fee", network="trc20").json()["data"] == {"fee": "1"}
    assert "usdt" in run("balances").json()["data"]["balance"]


def test_payroll_pays_valid_rows_and_skips_bad_addresses():
    res = client.post("/services/payroll", json={
        "token": "usdt_trc20", "mode": "practice",
        "rows": [{"name": "Ada", "wallet": TRX, "amount_ngn": 136000},
                 {"name": "Bayo", "wallet": "not-a-wallet", "amount_ngn": 90000}],
    }).json()
    assert [r["ok"] for r in res["results"]] == [True, False]
    # NGN 136,000 / 1,360 per USD (practice rate) / USD 1 per USDT = 100 USDT
    assert res["results"][0]["amount_token"] == "100.00000000"


def test_alerts_fire_once_when_the_price_crosses():
    sym = client.post("/services/alerts", json={"symbol": "btc", "direction": "above", "price_usd": 1})
    assert sym.status_code == 200
    board = client.get("/services/alerts").json()
    alert = next(a for a in board["alerts"] if a["id"] == sym.json()["id"])
    assert board["source"] in ("live", "practice") and alert["triggered_at"]
    client.delete(f"/services/alerts/{alert['id']}")
    assert all(a["id"] != alert["id"] for a in client.get("/services/alerts").json()["alerts"])


def test_history_records_every_action_for_the_panel():
    run("check-address", address=TRX)
    entries = client.get("/services/history", params={"panel": "withdraw"}).json()
    assert entries and entries[0]["mode"] == "practice" and entries[0]["panel"] == "withdraw"


def test_live_mode_respects_the_money_gate():
    with pytest.raises(services.ServiceError, match="LIVE mode"):
        services.run(
            services.ServiceRequest(action="send-coin", mode="live",
                                    params={"token": "usdt", "network": "trc20", "amount": "1", "to": TRX}),
            Settings(_env_file=None, ras_live_key="ras_live_k_0123456789abcdef0123"),
            "s",
        )


def test_unknown_action_is_404():
    assert run("drop-tables").status_code == 404
