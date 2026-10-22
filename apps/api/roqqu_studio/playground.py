"""Roqqu API playground: try any documented RAS endpoint from the studio.

The catalog (`integrations/roqqu/endpoints.json`) is generated from the Roqqu
API Service docs (roqqu-api-services.gitbook.io/ras) and covers every endpoint
there. Calls go through this server so the API key never reaches a browser, and
only catalog entries can be called (no free-form URLs).

Safety tiers:
  * public reads (prices, rates, supported networks): always allowed
  * authorised calls: need RAS_TEST_KEY (test mode) or RAS_LIVE_KEY
  * side effects (money moves, wallet create/delete, settings) in LIVE mode also
    need ALLOW_PRODUCTION_EXECUTION=true; test mode never moves real money
"""

from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, Field

from .config import Settings
from .integrations.roqqu.client import _form
from .observability import register_secret

_CATALOG = Path(__file__).parent / "integrations" / "roqqu" / "endpoints.json"
_PATH_VALUE_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class PlaygroundCall(BaseModel):
    endpoint: str
    params: dict[str, Any] = Field(default_factory=dict)


class PlaygroundError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


@lru_cache
def catalog() -> dict[str, Any]:
    return json.loads(_CATALOG.read_text(encoding="utf-8"))


def _endpoint(endpoint_id: str) -> dict[str, Any]:
    for e in catalog()["endpoints"]:
        if e["id"] == endpoint_id:
            return e
    raise PlaygroundError(404, f"unknown endpoint: {endpoint_id}")


def has_side_effects(e: dict[str, Any]) -> bool:
    return bool(e.get("side_effects") or e["moves_money"])


def _coerce(value: Any, kind: str) -> Any:
    # RAS docs type some crypto amounts as "integer" though they are fractional
    # (0.00002 BTC): validate as a decimal and send the exact text, never a float.
    if kind in ("number", "integer") and isinstance(value, str) and value.strip():
        try:
            if not Decimal(value.strip()).is_finite():
                raise InvalidOperation
        except InvalidOperation:
            raise PlaygroundError(400, f"{value!r} is not a number") from None
        return value.strip()
    return value


def build_request(e: dict[str, Any], params: dict[str, Any]) -> tuple[str, str, dict, dict]:
    """(method, path, query, body) for a catalog endpoint and user params."""
    path, query, body = e["path"], {}, {}
    for p in e["params"]:
        value = params.get(p["name"], "")
        if value in ("", None):
            if p["required"]:
                raise PlaygroundError(400, f"{p['name']} is required")
            continue
        value = _coerce(value, p["type"])
        if p["in"] == "path":
            if not _PATH_VALUE_RE.match(str(value)):
                raise PlaygroundError(400, f"{p['name']} must be letters, numbers, - or _ only")
            path = path.replace("{" + p["name"] + "}", str(value))
        elif p["in"] == "query":
            query[p["name"]] = value
        else:
            body[p["name"]] = value
    return e["method"], path, query, body


def call(
    req: PlaygroundCall, settings: Settings, *, transport: httpx.BaseTransport | None = None
) -> dict[str, Any]:
    e = _endpoint(req.endpoint)
    method, path, query, body = build_request(e, req.params)
    headers = {}
    if e["auth"]:
        if not settings.roqqu_secret_key:
            raise PlaygroundError(
                422, "This endpoint needs a RAS key. Set RAS_TEST_KEY (test mode) on the API."
            )
        register_secret(settings.roqqu_secret_key)
        headers[settings.ras_key_header] = settings.roqqu_secret_key
    if has_side_effects(e) and not settings.is_sandbox and not settings.allow_production_execution:
        raise PlaygroundError(
            422,
            "This call changes real money or wallets in LIVE mode. Use a RAS test key, or "
            "set ALLOW_PRODUCTION_EXECUTION=true on the API to allow it.",
        )

    base = settings.roqqu_base_url.rstrip("/")
    started = time.monotonic()
    try:
        with httpx.Client(timeout=20.0, transport=transport) as http:
            resp = http.request(method, base + path, params=query or None,
                                data=_form(body) if method != "GET" else None, headers=headers)
    except httpx.HTTPError as exc:
        raise PlaygroundError(502, f"Roqqu unreachable: {type(exc).__name__}") from None
    try:
        payload: Any = resp.json()
    except ValueError:
        payload = resp.text[:2000]
    return {
        "status": resp.status_code,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "request": {"method": method, "url": base + path, "query": query, "body": body},
        "response": payload,
    }
