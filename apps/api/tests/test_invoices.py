"""Invoices: create, share a link, buyer pays, Roqqu confirms (#85)."""

from __future__ import annotations

from fastapi.testclient import TestClient

import roqqu_studio.api.main as api_main
from roqqu_studio.analysis import analyze
from roqqu_studio.api.main import app
from roqqu_studio.orders import orders_service
from roqqu_studio.providers import default_catalog
from roqqu_studio.templates import build_template

client = TestClient(app)


def _invoice_artifact() -> str:
    wf = client.post("/workflows/from-template/invoice").json()["workflow"]
    res = client.post(
        f"/workflows/{wf['id']}/generate",
        json={"config": {"business_name": "Kunle Designs"}},
    )
    return res.json()["artifact_id"]


def test_invoice_template_is_registered_and_clean():
    report = analyze(build_template("invoice"), default_catalog())
    assert report.findings == []
    ids = [t["id"] for t in client.get("/templates").json()]
    assert "invoice" in ids


def test_moni_routes_invoice_talk(monkeypatch):
    import roqqu_studio.ai.moni as moni_mod
    from roqqu_studio.ai import classify_intent
    from roqqu_studio.ai.providers import KeywordFallback

    monkeypatch.setattr(moni_mod, "select_provider", lambda p=None: KeywordFallback())
    intent, _ = classify_intent("I need to invoice my client for a logo")
    assert intent.template_id == "invoice"


def test_dashboard_shows_invoices_section():
    artifact_id = _invoice_artifact()
    html = client.get(f"/preview/{artifact_id}/dashboard").text
    assert "Invoices" in html and "Create invoice" in html


def test_create_list_and_buyer_page():
    artifact_id = _invoice_artifact()
    res = client.post(
        f"/preview/{artifact_id}/invoices",
        json={"customer": "Chidi", "description": "Logo design", "amount": 25000},
    )
    assert res.status_code == 200
    inv = res.json()
    assert inv["reference"].startswith("INV-") and inv["status"] == "pending"

    listed = client.get(f"/preview/{artifact_id}/invoices").json()
    assert [i["reference"] for i in listed] == [inv["reference"]]

    page = client.get(f"/preview/{artifact_id}/invoice/{inv['reference']}").text
    assert "Chidi" in page and "Logo design" in page and "25,000" in page
    assert "Roqqu (Moniepoint) account" in page
    assert "Pay now" in page


def test_invoice_page_reads_like_a_document():  # noqa: E501 (#87)
    """Reference standard (Dockie/Carlofty): number, dates, table, totals, footer."""
    artifact_id = _invoice_artifact()
    inv = client.post(
        f"/preview/{artifact_id}/invoices",
        json={"customer": "Chidi", "description": "Logo design", "amount": 25000},
    ).json()
    page = client.get(f"/preview/{artifact_id}/invoice/{inv['reference']}").text
    for marker in (
        "Invoice number:",
        "Issued:",
        "Due:",
        "Billed to",
        "Description",
        "Subtotal",
        "Amount due",
        "page 1 of 1",
        inv["reference"],
    ):
        assert marker in page, f"invoice document missing {marker!r}"


def test_unpaid_invoice_verify_stays_pending_no_provider_call():
    artifact_id = _invoice_artifact()
    inv = client.post(
        f"/preview/{artifact_id}/invoices",
        json={"customer": "Ngozi", "description": "Consulting", "amount": 50000},
    ).json()
    res = client.post(f"/preview/{artifact_id}/orders/{inv['reference']}/verify")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "pending"
    assert "Share the invoice link" in body["note"]


def test_pay_then_verify_marks_paid(monkeypatch):
    artifact_id = _invoice_artifact()
    inv = client.post(
        f"/preview/{artifact_id}/invoices",
        json={"customer": "Bola", "description": "Website", "amount": 120000},
    ).json()

    class _FakeClient:
        def __init__(self, settings):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def initialize_transaction(self, **kw):
            return {
                "payment_reference": "PAYREF-1",
                "transaction_reference": "TXREF-1",
                "checkout_url": "https://sandbox.sdk.roqqu.com/checkout/x",
            }

    monkeypatch.setattr(api_main, "RoqquSandboxClient", _FakeClient)
    res = client.post(f"/preview/{artifact_id}/invoice/{inv['reference']}/pay")
    assert res.status_code == 200 and "checkout_url" in res.json()

    original = orders_service.verifier
    orders_service.verifier = lambda ref: {"status": "PAID", "amount_paid": 120000.0}
    try:
        verified = client.post(
            f"/preview/{artifact_id}/orders/{inv['reference']}/verify"
        ).json()
    finally:
        orders_service.verifier = original
    assert verified["status"] == "verified"

    page = client.get(f"/preview/{artifact_id}/invoice/{inv['reference']}").text
    assert "Paid and verified" in page
