"""Templates for the rest of the Roqqu API: data resale, crypto withdrawals,
customer KYC and price alerts. Each one must analyze clean (zero findings) as
authored, and only uses endpoints documented at developers.roqqu.com.
"""

from __future__ import annotations

from ..ir.models import Edge, Node, Position, Workflow


def _n(node_id: str, type_: str, label: str, x: int, y: int, **config) -> Node:
    return Node(id=node_id, type=type_, label=label, position=Position(x=x, y=y), config=config)


def _chain(*ids: str, first_kind: str = "event") -> list[Edge]:
    edges = [Edge(source=ids[0], target=ids[1], kind=first_kind)]
    edges += [Edge(source=a, target=b) for a, b in zip(ids[1:], ids[2:])]
    return edges


def sell_data() -> Workflow:
    """Sell data bundles: plan lookup, pay once, balance check, buy, receipt."""
    nodes = [
        _n("ask", "event.scheduled", "Customer Picks a Data Plan", 0, 0),
        _n("plans", "roqqu.data_bundles", "Look Up Plans (Get Data Bundles)", 240, 0, provider="mtn"),
        _n("once", "safety.idempotency_guard", "Sell Each Order Once", 480, 0),
        _n("balance", "safety.balance_guard", "Check Balance Covers the Plan", 720, 0),
        _n(
            "buy", "roqqu.buy_data", "Buy the Bundle", 960, 0,
            provider="mtn", variation_code="mtn-10mb-100", phone_number="",
        ),
        _n("notify", "app.notify_whatsapp", "Send the Receipt", 1200, 0,
           message="Your data bundle is active."),
        _n("audit", "safety.audit_event", "Audit Trail", 1440, 0),
    ]
    return Workflow(
        id="sell-data",
        name="Sell Data Bundles",
        provider="roqqu",
        description="Data resale on Roqqu: live plans, each order paid once, balance checked first.",
        nodes=nodes,
        edges=_chain("ask", "plans", "once", "balance", "buy", "notify", "audit"),
        entrypoint="ask",
    )


def withdrawals() -> Workflow:
    """Customer withdrawals: the destination address is checked before Send Token."""
    nodes = [
        _n("ask", "event.scheduled", "Customer Requests a Withdrawal", 0, 0),
        _n("once", "safety.idempotency_guard", "Process Each Request Once", 240, 0),
        _n(
            "address", "roqqu.blockchain_address", "Check the Destination Address", 480, 0,
            symbol="trx", addr="",
        ),
        _n("balance", "safety.balance_guard", "Check Balance Covers It", 720, 0),
        _n("send", "roqqu.send_token", "Send the Coins (Send Token)", 960, 0, token="trx", wallet=""),
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


def kyc() -> Workflow:
    """Verify a customer: BVN, then NIN, then their payout bank account."""
    nodes = [
        _n("signup", "event.scheduled", "Customer Submits Their Details", 0, 0),
        _n("bvn", "roqqu.bvn_verify", "Check BVN (NGN 20)", 240, 0, bvn=""),
        _n("match", "control.condition", "Name Matches the Sign-up?", 480, 0),
        _n("nin", "roqqu.nin_verify", "Check NIN as a Second Proof (NGN 100)", 720, 0, nin=""),
        _n(
            "bank", "roqqu.account_resolve", "Confirm Their Payout Account", 960, 0,
            account_number="", bank="",
        ),
        _n("notify", "app.notify_whatsapp", "Tell Them They Are Verified", 1200, 0,
           message="You are verified. Welcome aboard."),
        _n("audit", "safety.audit_event", "Audit Trail", 1440, 0),
    ]
    return Workflow(
        id="kyc",
        name="Verify Customers (KYC)",
        provider="roqqu",
        description="Know who you are paying: BVN, NIN and bank account checks through Roqqu.",
        nodes=nodes,
        edges=_chain("signup", "bvn", "match", "nin", "bank", "notify", "audit"),
        entrypoint="signup",
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
