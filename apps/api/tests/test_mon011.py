"""MON011 - beneficiary account must be validated before a transfer (#24)."""

from __future__ import annotations

from roqqu_studio.analysis import analyze
from roqqu_studio.fixtures import safe_marketplace
from roqqu_studio.ir.models import Edge, Node, Workflow
from roqqu_studio.providers import default_catalog
from roqqu_studio.remediation import apply_fix


def _transfer_wf(with_validation: bool) -> Workflow:
    """A minimal payout: confirm → [validate?] → transfer."""
    nodes = [
        Node(id="confirm", type="event.fulfilment_confirmed"),
        Node(id="transfer", type="roqqu.send_token"),
    ]
    edges = [Edge(source="confirm", target="transfer", kind="event")]
    if with_validation:
        nodes.insert(1, Node(id="validate", type="roqqu.blockchain_address"))
        edges = [
            Edge(source="confirm", target="validate", kind="event"),
            Edge(source="validate", target="transfer"),
        ]
    return Workflow(id="t", name="t", nodes=nodes, edges=edges, entrypoint="confirm")


def _ids(wf) -> set[str]:
    return {f.rule_id for f in analyze(wf, default_catalog()).findings}


def test_mon011_fires_when_transfer_is_unvalidated():
    assert "MON011" in _ids(_transfer_wf(with_validation=False))


def test_mon011_clears_when_beneficiary_is_validated():
    assert "MON011" not in _ids(_transfer_wf(with_validation=True))


def test_safe_hero_validates_before_payout():
    # The hero must model the validation, so MON011 never fires on it.
    assert "MON011" not in _ids(safe_marketplace())


def test_apply_fix_mon011_inserts_validation_and_clears():
    catalog = default_catalog()
    wf = _transfer_wf(with_validation=False)
    finding = next(f for f in analyze(wf, catalog).findings if f.rule_id == "MON011")
    fixed, step = apply_fix(wf, finding, catalog)
    assert step.added_nodes
    assert "MON011" not in _ids(fixed)
