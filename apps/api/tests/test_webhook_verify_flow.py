"""A deposit->webhook->verify->notify flow must COMPLETE against Roqqu (#Flow 1).

When Rooky composes a webhook-driven flow, `verify` hangs off the webhook island,
so no direct edge carries the initialize's payment_reference. Verify must still
find the one real reference the run minted (from the initialize) and query it,
instead of dead-ending at "no payment_reference" - which mislabels the run as
FAILED and starves the downstream notify node.
"""

from __future__ import annotations

from roqqu_studio.config import Settings
from roqqu_studio.executor import RunStatus, execution_store, run_workflow
from roqqu_studio.executor.adapter import SandboxAdapter, _run_payment_reference
from roqqu_studio.ir.models import Edge, Node, Workflow


class _FakeRoqqu:
    """Records what verify was asked to query, returns provider truth."""

    def __init__(self) -> None:
        self.queried: list[str] = []

    def generate_wallet(self, *, network, customer=None):
        return {"address": "pay-real-123", "network": network}

    def wallet_received(self, *, network, address):
        self.queried.append(address)
        return {"status": "PENDING", "amount_token": "0"}


def _webhook_first_flow() -> Workflow:
    """init is an island; the webhook island drives verify -> notify."""
    return Workflow(
        id="wh", name="card-webhook-verify-notify", entrypoint="init",
        nodes=[
            Node(id="init", type="roqqu.generate_wallet", config={"amount": "7500"}),
            Node(id="hook", type="event.payment_webhook"),
            Node(id="verify", type="roqqu.get_wallets"),
            Node(id="notify", type="app.notify_whatsapp", config={"message": "Payment confirmed"}),
        ],
        edges=[
            Edge(source="hook", target="verify", kind="event"),
            Edge(source="verify", target="notify"),
        ],
    )


def _sandbox_adapter() -> tuple[SandboxAdapter, _FakeRoqqu]:
    adapter = SandboxAdapter(
        Settings(_env_file=None, ras_test_key="ras_test_s_0123456789abcdef0123456789", roqqu_ngn_per_usd="1500")
    )
    fake = _FakeRoqqu()
    adapter._client = fake  # _c() returns the set client, so no network
    return adapter, fake


def test_run_payment_reference_finds_the_real_ref() -> None:
    context = {"outputs": {"init": {"payment_reference": "pay-real-123"}, "hook": {"event": "arrived"}}}
    assert _run_payment_reference(context) == "pay-real-123"
    assert _run_payment_reference({"outputs": {}}) is None


def test_webhook_first_flow_completes_and_verifies_real_reference() -> None:
    adapter, fake = _sandbox_adapter()
    run = run_workflow(_webhook_first_flow(), adapter=adapter)

    # The run completes instead of failing at verify...
    assert run.status is RunStatus.COMPLETED
    # ...because verify queried the REAL reference the initialize minted...
    assert fake.queried == ["pay-real-123"]
    # ...and the downstream notify node actually ran.
    node_ids = {e.node_id for e in execution_store.list_events(run.id) if e.node_id}
    assert {"init", "hook", "verify", "notify"} <= node_ids
