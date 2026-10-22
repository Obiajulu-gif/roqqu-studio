"""Generated JavaScript: valid for every template, and it really runs.

The run test starts a tiny mock of api.roqqu.com and executes the generated
module with node, so the code a developer copies is proven end to end."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs

import pytest
from fastapi.testclient import TestClient

from roqqu_studio.api.main import app
from roqqu_studio.codegen import generate_javascript
from roqqu_studio.templates import build_template, list_templates

NODE = shutil.which("node")
client = TestClient(app)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
@pytest.mark.parametrize("template_id", [t.id for t in list_templates()])
def test_every_template_generates_valid_javascript(template_id, tmp_path):
    path = tmp_path / f"{template_id}.mjs"
    path.write_text(generate_javascript(build_template(template_id)), encoding="utf-8")
    result = subprocess.run([NODE, "--check", str(path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


class _MockRoqqu(BaseHTTPRequestHandler):
    """A tiny service.roqqu.com: form-encoded POSTs, the RAS envelope back."""

    seen: list[tuple[str, str, dict]] = []

    def _reply(self, data):
        body = json.dumps({"status": "success", "message": "ok", "data": data}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        form = {k: v[0] for k, v in parse_qs(self.rfile.read(length).decode()).items()}
        self.seen.append(("POST", self.path, {"key": self.headers.get("x-staging-api-key"), **form}))
        if self.path.endswith("/wallets/what-network"):
            return self._reply(["trc20"])
        if self.path.endswith("/wallets/send"):
            return self._reply({"refid": "10704380386654367514"})
        return self._reply(None)

    def do_GET(self):  # noqa: N802
        self.seen.append(("GET", self.path, {}))
        return self._reply({"btc": {"price": 1, "change": 0}})

    def log_message(self, *args):
        return


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_generated_withdrawal_flow_runs_against_a_mock_roqqu(tmp_path):
    server = HTTPServer(("127.0.0.1", 0), _MockRoqqu)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        path = tmp_path / "withdrawals.mjs"
        path.write_text(generate_javascript(build_template("withdrawals")), encoding="utf-8")
        env = {**os.environ, "ROQQU_BASE_URL": f"http://127.0.0.1:{server.server_port}",
               "RAS_TEST_KEY": "ras_test_key_0123456789abcdef0123"}
        result = subprocess.run([NODE, str(path)], capture_output=True, text=True, env=env, timeout=60)
    finally:
        server.shutdown()
    assert result.returncode == 0, result.stderr
    paths = [p for _, p, _ in _MockRoqqu.seen]
    # The address is checked before any money moves.
    assert paths.index("/wallets/what-network") < paths.index("/wallets/send")
    sent = next(b for m, p, b in _MockRoqqu.seen if p == "/wallets/send")
    assert sent["key"] == "ras_test_key_0123456789abcdef0123"
    assert sent["network"] == "trc20" and sent["token"] == "usdt"
    assert "10704380386654367514" in result.stdout  # the refid flowed back into ctx


def test_code_endpoint_serves_python_and_javascript():
    wf = client.post("/workflows/from-template/sell-online").json()["workflow"]
    py = client.get(f"/workflows/{wf['id']}/code").json()
    js = client.get(f"/workflows/{wf['id']}/code", params={"lang": "javascript"}).json()
    assert py["filename"].endswith(".py") and "def run()" in py["code"]
    assert js["filename"].endswith(".mjs") and "export async function run()" in js["code"]
    assert "https://service.roqqu.com/v1" in js["code"]
    assert client.get(f"/workflows/{wf['id']}/code", params={"lang": "cobol"}).status_code == 400
