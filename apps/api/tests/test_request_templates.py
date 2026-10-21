"""Every Roqqu block ships its request body, grounded in the spec (#176)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from roqqu_studio.api.main import app
from roqqu_studio.providers import default_catalog

client = TestClient(app)

# The 10 Roqqu endpoints we model, each must carry method + path + a body.
_ROQQU_TYPES = {
    "roqqu.initialize_transaction",
    "roqqu.verify_transaction",
    "roqqu.create_reserved_account",
    "roqqu.create_invoice",
    "roqqu.initiate_transfer",
    "roqqu.bulk_transfer",
    "roqqu.query_transfer_status",
    "roqqu.validate_bank_account",
    "roqqu.transaction_split",
    "roqqu.initiate_refund",
}


def test_every_roqqu_node_has_a_grounded_request_template():
    catalog = default_catalog()
    for t in _ROQQU_TYPES:
        defn = catalog.resolve(t)
        assert defn.method in {"GET", "POST", "PUT"}, t
        assert defn.path.startswith("/api/"), t
        assert defn.request_template, f"{t} has no request template"


def test_catalog_endpoint_ships_the_template_to_the_ui():
    catalog = client.get("/catalog").json()
    init = catalog["roqqu.initialize_transaction"]
    assert init["method"] == "POST"
    assert init["path"] == "/api/v1/merchant/transactions/init-transaction"
    body = init["request_template"]
    # Exact fields from the Roqqu OpenAPI spec.
    for field in ("amount", "customerName", "customerEmail", "paymentReference",
                  "contractCode", "currencyCode"):
        assert field in body, field
    # doc grounding travels too, so Moni/the dev reason from the real shape.
    assert init["doc_url"]
    assert init["when_to_use"]


def test_transfer_template_matches_disbursement_fields():
    catalog = client.get("/catalog").json()
    tx = catalog["roqqu.initiate_transfer"]
    assert tx["path"] == "/api/v2/disbursements/single"
    for field in ("amount", "destinationBankCode", "destinationAccountNumber",
                  "reference", "narration"):
        assert field in tx["request_template"], field


def test_non_roqqu_nodes_have_no_endpoint():
    """Safety/app nodes are local logic, not HTTP calls - no request template."""
    catalog = client.get("/catalog").json()
    guard = catalog.get("safety.balance_guard")
    if guard is not None:
        assert guard["request_template"] == {}
        assert guard["path"] == ""
