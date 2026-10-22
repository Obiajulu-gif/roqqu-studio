"""RAS webhook receiver: key-decrypted trigger, Get-Addresses-verified truth (#178).

RAS POSTs `{"hash": <hex>}`, AES-256-CTR encrypted with our API key, IV in the
`x-api-key` header. We practice what MON002 preaches: only a body that decrypts
with one of our keys counts, and even then it is only a trigger - the order
flips solely on the authoritative Get Addresses check.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from roqqu_studio.api.main import app
from roqqu_studio.integrations.roqqu import encrypt_webhook
from roqqu_studio.orders import orders_service

client = TestClient(app)

_WF_KEY = "ras_test_workflow_key_0123456789abcdef"


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
        inv["reference"], payment_reference=address, transaction_reference="usdt_trc20:4"
    )
    client.put(f"/workflows/{wf['id']}/credentials", json={"secret_key": _WF_KEY, "mode": "test"})
    return inv["reference"], address


def _deposit(address: str, key: str, **meta):
    event = {"event_id": "e1", "event_type": "token_received",
             "meta_data": {"address": address, "network": "trc20", "token": "usdt", "value": 4, **meta}}
    body, iv = encrypt_webhook(event, key)
    return client.post("/roqqu/webhook", json=body, headers={"x-api-key": iv})


def test_webhook_rejects_a_body_encrypted_with_another_key():
    _, address = _paid_pending_invoice()
    assert _deposit(address, "forged_key_forged_key_forged_key_xx").status_code == 401


def test_webhook_with_our_key_triggers_verify():
    reference, address = _paid_pending_invoice()
    original = orders_service.verifier
    orders_service.verifier = lambda ref: {"status": "PAID", "amount_paid": 5000.0}
    try:
        res = _deposit(address, _WF_KEY)
    finally:
        orders_service.verifier = original
    assert res.status_code == 200
    assert res.json()["matched"] is True
    assert res.json()["status"] == "verified"
    assert orders_service.get(reference).status.value == "verified"


def test_webhook_for_an_unknown_address_is_ignored():
    _paid_pending_invoice()  # registers _WF_KEY
    res = _deposit("T-not-ours", _WF_KEY)
    assert res.status_code == 200
    assert res.json() == {"received": True, "matched": False}


def test_webhook_amount_is_never_trusted():
    """A genuine webhook claiming a deposit still cannot flip an order Roqqu denies."""
    reference, address = _paid_pending_invoice()
    original = orders_service.verifier
    orders_service.verifier = lambda ref: {"status": "PENDING", "amount_paid": 0}
    try:
        res = _deposit(address, _WF_KEY, value=999999)
    finally:
        orders_service.verifier = original
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"
    assert orders_service.get(reference).status.value == "rejected"


def test_garbage_body_is_rejected():
    res = client.post("/roqqu/webhook", json={"hash": "00ff"}, headers={"x-api-key": "00" * 16})
    assert res.status_code == 401
