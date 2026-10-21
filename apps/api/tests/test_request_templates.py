"""Every Roqqu block ships its request body, grounded in the spec (#176)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from roqqu_studio.api.main import app
from roqqu_studio.providers import default_catalog

client = TestClient(app)

# The 10 Roqqu endpoints we model, each must carry method + path + a body.
_ROQQU_TYPES = {
    "roqqu.generate_wallet",
    "roqqu.get_wallets",
    "roqqu.member_wallet",
    "roqqu.invoice_wallet",
    "roqqu.send_token",
    "roqqu.batch_send",
    "roqqu.blockchain_address",
    "roqqu.account_resolve",
    "roqqu.split_send",
    "roqqu.refund_send",
}


def test_every_roqqu_node_has_a_grounded_request_template():
    catalog = default_catalog()
    for t in _ROQQU_TYPES:
        defn = catalog.resolve(t)
        assert defn.method in {"GET", "POST", "PUT"}, t
        assert defn.path.startswith("/user/") or defn.path in ("/price", "/blockchain/address"), t
        assert defn.request_template, f"{t} has no request template"


def test_catalog_endpoint_ships_the_template_to_the_ui():
    catalog = client.get("/catalog").json()
    init = catalog["roqqu.generate_wallet"]
    assert init["method"] == "POST"
    assert init["path"] == "/user/generate-wallet"
    # Exact field from the Roqqu OpenAPI spec (developers.roqqu.com).
    assert init["request_template"] == {"token": "trx"}
    # doc grounding travels too, so Moni/the dev reason from the real shape.
    assert init["doc_url"]
    assert init["when_to_use"]


def test_transfer_template_matches_disbursement_fields():
    catalog = client.get("/catalog").json()
    tx = catalog["roqqu.send_token"]
    assert tx["path"] == "/user/send-trx"
    assert set(tx["request_template"]) == {"amount", "wallet"}


def test_non_roqqu_nodes_have_no_endpoint():
    """Safety/app nodes are local logic, not HTTP calls - no request template."""
    catalog = client.get("/catalog").json()
    guard = catalog.get("safety.balance_guard")
    if guard is not None:
        assert guard["request_template"] == {}
        assert guard["path"] == ""
