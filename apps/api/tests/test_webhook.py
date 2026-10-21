"""Roqqu webhook receiver: secret-gated trigger, Get-Wallets-verified truth (#178).

Roqqu's Receive Token webhook POSTs {secret, token, amount, address, timestamp}.
We practice what MON002 preaches: the body's `secret` must equal the one set on
the Roqqu dashboard before anything happens, and even then the payload is only
a trigger - the order flips solely on the authoritative Get Wallets check.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from roqqu_studio.api.main import app
from roqqu_studio.orders import orders_service

client = TestClient(app)

_WF_SECRET = "hook_secret_test"


def _paid_pending_invoice() -> tuple[str, str]:
    """An invoice with a deposit address attached (PENDING) and the address."""
    wf = client.post("/workflows/from-template/invoice").json()["workflow"]
    artifact_id = client.post(
        f"/workflows/{wf['id']}/generate",
        json={"config": {"business_name": "Webhook Test Co"}},
    ).json()["artifact_id"]
    inv = client.post(
        f"/preview/{artifact_id}/invoices",
        json={"customer": "Ada", "description": "Ajo round", "amount": 5000},
    ).json()
    address = f"T-{inv['reference']}"
    orders_service.attach_payment(
        inv["reference"], payment_reference=address, transaction_reference="trx:4"
    )
    client.put(
        f"/workflows/{wf['id']}/credentials",
        json={"secret_key": "RQ-SEC-wh", "webhook_secret": _WF_SECRET},
    )
    return inv["reference"], address


def _deposit(address: str, secret: str, **extra) -> dict:
    body = {"secret": secret, "token": "trx", "amount": "4", "address": address,
            "timestamp": "2026-10-21T10:00:00Z"}
    body.update(extra)
    return client.post("/roqqu/webhook", json=body)


def test_webhook_rejects_wrong_secret():
    _, address = _paid_pending_invoice()
    assert _deposit(address, "forged").status_code == 401


def test_webhook_with_right_secret_triggers_verify():
    reference, address = _paid_pending_invoice()
    original = orders_service.verifier
    orders_service.verifier = lambda ref: {"status": "PAID", "amount_paid": 5000.0}
    try:
        res = _deposit(address, _WF_SECRET)
    finally:
        orders_service.verifier = original
    assert res.status_code == 200
    assert res.json()["matched"] is True
    assert res.json()["status"] == "verified"
    assert orders_service.get(reference).status.value == "verified"


def test_webhook_with_platform_secret_but_unknown_address_is_ignored(monkeypatch):
    from roqqu_studio.config import Settings

    monkeypatch.setattr(
        "roqqu_studio.credentials.get_settings",
        lambda: Settings(_env_file=None, roqqu_webhook_secret="PLATFORM_SECRET"),
    )
    res = _deposit("T-not-ours", "PLATFORM_SECRET")
    assert res.status_code == 200
    assert res.json() == {"received": True, "matched": False}


def test_webhook_amount_is_never_trusted():
    """A genuine webhook claiming a deposit still cannot flip an order Roqqu denies."""
    reference, address = _paid_pending_invoice()
    original = orders_service.verifier
    orders_service.verifier = lambda ref: {"status": "PENDING", "amount_paid": 0}
    try:
        res = _deposit(address, _WF_SECRET, amount="999999")
    finally:
        orders_service.verifier = original
    assert res.status_code == 200
    # Get Wallets saw nothing, so the claim lands as rejected: the payload's
    # amount changed nothing. That is the point.
    assert res.json()["status"] == "rejected"
    assert orders_service.get(reference).status.value == "rejected"


def test_empty_secret_never_matches(monkeypatch):
    from roqqu_studio.config import Settings

    monkeypatch.setattr(
        "roqqu_studio.credentials.get_settings",
        lambda: Settings(_env_file=None, roqqu_webhook_secret=""),
    )
    assert _deposit("T-not-ours", "").status_code == 401
