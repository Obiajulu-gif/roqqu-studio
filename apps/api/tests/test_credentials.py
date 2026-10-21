"""Per-workflow Roqqu credentials: their secrets, their money (#68, D19)."""

from __future__ import annotations

import io
import json

from fastapi.testclient import TestClient

from roqqu_studio.api.main import app
from roqqu_studio.credentials import CredentialStore, RoqquCredentials
from roqqu_studio.observability import configure_logging, get_logger

client = TestClient(app)

_CREDS = {"secret_key": "RQ-SEC-super_secret_9z", "webhook_secret": "hook_secret_77"}


def _a_workflow_id() -> str:
    # A real, stored workflow (from-template) so the credential endpoints accept it.
    return client.post("/workflows/from-template/sell-online").json()["workflow"]["id"]


def test_put_get_delete_roundtrip():
    wid = _a_workflow_id()
    assert client.get(f"/workflows/{wid}/credentials").json()["source"] in {"platform", "none"}

    res = client.put(f"/workflows/{wid}/credentials", json=_CREDS)
    assert res.status_code == 200
    assert res.json() == {"workflow_id": wid, "configured": True, "source": "workflow"}

    assert client.get(f"/workflows/{wid}/credentials").json()["source"] == "workflow"
    client.delete(f"/workflows/{wid}/credentials")
    assert client.get(f"/workflows/{wid}/credentials").json()["source"] in {"platform", "none"}


def test_secret_values_are_never_returned():
    wid = _a_workflow_id()
    for res in (
        client.put(f"/workflows/{wid}/credentials", json=_CREDS),
        client.get(f"/workflows/{wid}/credentials"),
    ):
        body = res.text
        assert _CREDS["webhook_secret"] not in body
        assert _CREDS["secret_key"] not in body
        assert "secret_key" not in res.json()  # no secret fields on the model at all


def test_credentials_require_a_real_workflow():
    assert client.put("/workflows/nope/credentials", json=_CREDS).status_code == 404


def test_settings_for_prefers_workflow_then_platform():
    store = CredentialStore()
    # No creds: falls back to platform settings (base url unchanged).
    platform = store.settings_for("wf-x")
    assert platform.roqqu_base_url == "https://api.roqqu.com/prod/v1"

    store.put("wf-x", RoqquCredentials(**_CREDS))
    resolved = store.settings_for("wf-x")
    assert resolved.roqqu_secret_key == _CREDS["secret_key"]
    assert resolved.roqqu_webhook_secret == _CREDS["webhook_secret"]
    # The user set keys, but NOT the base url: it stays platform-pinned (guard).
    assert resolved.roqqu_base_url == platform.roqqu_base_url


def test_stored_secret_is_redacted_in_logs():
    buf = io.StringIO()
    configure_logging(stream=buf)
    CredentialStore().put("wf-log", RoqquCredentials(**_CREDS))
    get_logger("t").info("using key", note=f"key is {_CREDS['secret_key']}")
    line = json.loads([x for x in buf.getvalue().splitlines() if x.strip()][-1])
    assert _CREDS["secret_key"] not in line["note"]
