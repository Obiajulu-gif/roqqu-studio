"""Rooky's deterministic generate-verify-refine-refuse loop (#106).

The product thesis is "a 200 doesn't mean the integration is correct." These
tests hold Rooky to it: she may only ever hand over an analyzer-clean flow, and
must refuse honestly otherwise, never 500, never leak.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import roqqu_studio.ai.composer as comp
from roqqu_studio.ai.composer import (
    ComposeError,
    ComposeRefused,
    ComposeUnavailable,
    compose_flow,
)
from roqqu_studio.ai.schema import RookyFlow, RookyFlowEdge, RookyFlowNode
from roqqu_studio.api.main import app

client = TestClient(app)


def _flow(**over) -> RookyFlow:
    base = dict(
        name="Sell online",
        nodes=[
            RookyFlowNode(id="init", type="roqqu.generate_wallet"),
            RookyFlowNode(id="webhook", type="event.payment_webhook"),
            RookyFlowNode(id="vsig", type="safety.verify_signature"),
            RookyFlowNode(id="verify", type="roqqu.get_wallets"),
            RookyFlowNode(id="vamt", type="safety.validate_amount"),
            RookyFlowNode(id="idem", type="safety.idempotency_guard"),
            RookyFlowNode(id="paid", type="app.mark_order_paid"),
        ],
        edges=[
            RookyFlowEdge(source="init", target="webhook"),
            RookyFlowEdge(source="webhook", target="vsig", kind="event"),
            RookyFlowEdge(source="vsig", target="verify"),
            RookyFlowEdge(source="verify", target="vamt"),
            RookyFlowEdge(source="vamt", target="idem"),
            RookyFlowEdge(source="idem", target="paid"),
        ],
    )
    base.update(over)
    return RookyFlow(**base)


class _Fake:
    name = "fake"

    def __init__(self, flow: RookyFlow) -> None:
        self.flow = flow
        self.calls = 0

    def available(self) -> bool:
        return True

    def structured(self, **_):
        self.calls += 1
        return self.flow


# --- THE invariant: never ship a flow the analyzer still flags -----------------


def test_unclean_compose_refuses_and_returns_no_workflow(monkeypatch):
    """If Apply-Fix cannot make it clean, Rooky must refuse, not hand it over."""
    monkeypatch.setattr(comp, "select_provider", lambda p=None: _Fake(_flow()))
    # Force the analyzer to always report a finding, so no proposal is ever clean.
    from roqqu_studio.analysis import Finding, Report

    def _always_dirty(_wf, _cat):
        return Report(
            findings=[Finding(rule_id="MON999", severity="critical", message="stub",
                              path=["init"], title="stub")]
        )

    monkeypatch.setattr(comp, "analyze", _always_dirty)
    with pytest.raises(ComposeError):
        compose_flow("sell online")


def test_endpoint_unclean_compose_is_422_with_no_workflow(monkeypatch):
    monkeypatch.setattr(comp, "select_provider", lambda p=None: _Fake(_flow()))
    from roqqu_studio.analysis import Finding, Report

    monkeypatch.setattr(
        comp, "analyze",
        lambda _w, _c: Report(findings=[Finding(rule_id="MON999", severity="critical",
                                                message="stub", path=["init"], title="stub")]),
    )
    res = client.post("/assistant/compose", json={"message": "sell online"})
    assert res.status_code == 422
    assert "workflow" not in res.json()  # nothing unsafe is returned


def test_clean_proposal_is_returned(monkeypatch):
    monkeypatch.setattr(comp, "select_provider", lambda p=None: _Fake(_flow()))
    outcome = compose_flow("sell online")
    assert outcome.report_after.findings == []
    assert len(outcome.workflow.nodes) == 7


# --- Honest refusal ------------------------------------------------------------


def test_infeasible_request_is_declined_not_fabricated(monkeypatch):
    refusal = RookyFlow(name="n/a", feasible=False,
                       refusal="I build Roqqu payment flows, not rockets.")
    monkeypatch.setattr(comp, "select_provider", lambda p=None: _Fake(refusal))
    with pytest.raises(ComposeRefused) as ei:
        compose_flow("build me a rocket to the moon")
    assert "rocket" in str(ei.value).lower()


def test_infeasible_endpoint_is_422_friendly(monkeypatch):
    refusal = RookyFlow(name="n/a", feasible=False, refusal="Not a payment flow.")
    monkeypatch.setattr(comp, "select_provider", lambda p=None: _Fake(refusal))
    res = client.post("/assistant/compose", json={"message": "poem about the sea"})
    assert res.status_code == 422
    assert "can't build" in res.json()["detail"].lower()


# --- Transport error is 503, not a fake "bad JSON" 422 -------------------------


def test_provider_outage_is_503_not_422(monkeypatch):
    class _Down:
        name = "fake"

        def available(self):
            return True

        def structured(self, **_):
            raise ConnectionError("provider down")  # transport, not a JSON fault

    monkeypatch.setattr(comp, "select_provider", lambda p=None: _Down())
    with pytest.raises(ComposeUnavailable):
        compose_flow("sell online")
    res = client.post("/assistant/compose", json={"message": "sell online"})
    assert res.status_code == 503


# --- Degenerate graphs are rejected, not passed as "clean" ---------------------


def test_disconnected_graph_is_rejected(monkeypatch):
    islands = RookyFlow(
        name="islands",
        nodes=[
            RookyFlowNode(id="a", type="roqqu.generate_wallet"),
            RookyFlowNode(id="b", type="app.notify"),
        ],
        edges=[],  # nothing connected: nothing reachable, would pass vacuously
    )
    fake = _Fake(islands)
    monkeypatch.setattr(comp, "select_provider", lambda p=None: fake)
    with pytest.raises(ComposeError):
        compose_flow("anything")
    assert fake.calls == comp._MAX_ROUNDS  # never accepted the inert graph
