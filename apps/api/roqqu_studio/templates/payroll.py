"""Payroll template: pay staff salaries safely (#54, D17).

Canvas-first template (mock execution; sandbox disbursement needs OTP disabled,
see #9). The correctness story is MON011 made visible: every beneficiary account
is validated by Name Enquiry BEFORE the bulk transfer, so salaries never leave
for a mistyped or fraudulent account. Delete the validation node on stage and
the analyzer flags it immediately: that is the hood-open beat.

Must analyze clean (zero findings) as authored.
"""

from __future__ import annotations

from ..ir.models import Edge, Node, Position, Variable, Workflow


def _n(node_id: str, type_: str, label: str, x: int, y: int) -> Node:
    return Node(id=node_id, type=type_, label=label, position=Position(x=x, y=y))


def payroll() -> Workflow:
    """Scheduled payroll run. Expected findings: none."""
    nodes = [
        _n("payday", "event.scheduled", "Payday (monthly)", 0, 0),
        _n("rows", "app.data_rows", "Employee List (CSV / Sheet)", 240, 0),
        _n("validate", "roqqu.blockchain_address", "Check Each Wallet Address", 480, 0),
        # The live merchant failure: payday fires, wallet cannot cover it (#108).
        _n("balance", "safety.balance_guard", "Check Balance Covers Payroll", 720, 0),
        _n("bulk", "roqqu.batch_send", "Send Each Salary (Send Coin)", 960, 0),
        _n("qstatus", "roqqu.tx_status", "Check Each Send Status", 1200, 0),
        _n("recon", "safety.reconciliation", "Reconcile Payouts", 1440, 0),
        _n("audit", "safety.audit_event", "Audit Trail", 1680, 0),
    ]
    edges = [
        Edge(source="payday", target="rows", kind="event"),
        Edge(source="rows", target="validate"),
        Edge(source="validate", target="balance"),
        Edge(source="balance", target="bulk"),
        Edge(source="bulk", target="qstatus"),
        Edge(source="qstatus", target="recon"),
        Edge(source="recon", target="audit"),
    ]
    return Workflow(
        id="payroll",
        name="Staff Payroll",
        provider="roqqu",
        description=(
            "Monthly payroll: employee rows in, every wallet address checked before the "
            "batch send, batch queried and reconciled after (#54)."
        ),
        variables={"payroll_month": Variable(name="payroll_month")},
        nodes=nodes,
        edges=edges,
        entrypoint="payday",
    )
