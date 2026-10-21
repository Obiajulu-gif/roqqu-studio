"""Bills template: buy airtime and electricity through Roqqu's ancillary services.

The correctness story: a meter number is checked with Roqqu's Verify Meter
(it returns the customer's name) BEFORE any money is spent, each request is
processed once (a retried button press must not buy units twice), and the
balance is checked first because Roqqu deducts bills from your wallet.

Must analyze clean (zero findings) as authored.
"""

from __future__ import annotations

from ..ir.models import Edge, Node, Position, Workflow


def _n(node_id: str, type_: str, label: str, x: int, y: int, **config) -> Node:
    return Node(id=node_id, type=type_, label=label, position=Position(x=x, y=y), config=config)


def bills() -> Workflow:
    """A customer asks to pay a bill. Expected findings: none."""
    nodes = [
        _n("ask", "event.scheduled", "Customer Requests a Bill Payment", 0, 0),
        _n(
            "meter", "roqqu.verify_meter", "Check the Meter Belongs to Them", 240, 0,
            provider="ikeja", meter_type="prepaid", meter_number="",
        ),
        _n("once", "safety.idempotency_guard", "Pay Each Request Once", 480, 0),
        _n("balance", "safety.balance_guard", "Check Balance Covers the Bill", 720, 0),
        _n(
            "power", "roqqu.pay_electric", "Buy Electricity Units", 960, 0,
            provider="ikeja", meter_type="prepaid", meter_number="", amount="5000",
            phone_number="",
        ),
        _n(
            "airtime", "roqqu.recharge_airtime", "Top Up Airtime (optional)", 960, 170,
            phone_number="", amount="500",
        ),
        _n("notify", "app.notify_whatsapp", "Send the Receipt", 1200, 0,
           message="Your bill payment went through."),
        _n("audit", "safety.audit_event", "Audit Trail", 1440, 0),
    ]
    edges = [
        Edge(source="ask", target="meter", kind="event"),
        Edge(source="meter", target="once"),
        Edge(source="once", target="balance"),
        Edge(source="balance", target="power"),
        Edge(source="balance", target="airtime"),
        Edge(source="power", target="notify"),
        Edge(source="airtime", target="notify"),
        Edge(source="notify", target="audit"),
    ]
    return Workflow(
        id="pay-bills",
        name="Pay Bills (electricity & airtime)",
        provider="roqqu",
        description=(
            "Electricity and airtime through Roqqu: the meter is verified by name "
            "first, each request is paid once, and the wallet balance is checked."
        ),
        nodes=nodes,
        edges=edges,
        entrypoint="ask",
    )
