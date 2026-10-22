"""Templates for the rest of the Roqqu API Service: crypto withdrawals and price
alerts. Each one must analyze clean (zero findings) as authored, and only uses
endpoints documented at https://roqqu-api-services.gitbook.io/ras.
"""

from __future__ import annotations

from ..ir.models import Edge, Node, Position, Workflow


def _n(node_id: str, type_: str, label: str, x: int, y: int, **config) -> Node:
    return Node(id=node_id, type=type_, label=label, position=Position(x=x, y=y), config=config)


def _chain(*ids: str, first_kind: str = "event") -> list[Edge]:
    edges = [Edge(source=ids[0], target=ids[1], kind=first_kind)]
    edges += [Edge(source=a, target=b) for a, b in zip(ids[1:], ids[2:])]
    return edges


def withdrawals() -> Workflow:
    """Customer withdrawals: the destination address is checked before Send."""
    nodes = [
        _n("ask", "event.scheduled", "Customer Requests a Withdrawal", 0, 0),
        _n("once", "safety.idempotency_guard", "Process Each Request Once", 240, 0),
        _n(
            "address", "roqqu.blockchain_address", "Check the Destination Address", 480, 0,
            network="trc20", address="",
        ),
        _n("balance", "safety.balance_guard", "Check Balance Covers It", 720, 0),
        _n("send", "roqqu.send_token", "Send the Coins (Send Coin)", 960, 0, network="trc20", token="usdt", to=""),
        _n("ledger", "app.credit_ledger", "Debit the Customer's Balance", 1200, 0),
        _n("notify", "app.notify_whatsapp", "Tell the Customer", 1440, 0,
           message="Your withdrawal is on its way."),
        _n("audit", "safety.audit_event", "Audit Trail", 1680, 0),
    ]
    return Workflow(
        id="withdrawals",
        name="Customer Crypto Withdrawals",
        provider="roqqu",
        description=(
            "Pay customers out in crypto: one request, one payout, a real destination "
            "address and enough balance, every time."
        ),
        nodes=nodes,
        edges=_chain("ask", "once", "address", "balance", "send", "ledger", "notify", "audit"),
        entrypoint="ask",
    )


def price_alerts() -> Workflow:
    """Watch Roqqu prices and message the owner when a coin crosses a level."""
    nodes = [
        _n("tick", "event.scheduled", "Every 15 Minutes", 0, 0),
        _n("prices", "roqqu.all_prices", "Get All Prices", 240, 0),
        _n("cross", "control.condition", "BTC Crossed My Level?", 480, 0),
        _n("notify", "app.notify_whatsapp", "Alert Me on WhatsApp", 720, 0,
           message="BTC crossed your price level on Roqqu."),
        _n("audit", "safety.audit_event", "Log the Alert", 960, 0),
    ]
    return Workflow(
        id="price-alerts",
        name="Crypto Price Alerts",
        provider="roqqu",
        description="Live Roqqu prices checked on a schedule, with a WhatsApp alert on a move.",
        nodes=nodes,
        edges=_chain("tick", "prices", "cross", "notify", "audit"),
        entrypoint="tick",
    )
