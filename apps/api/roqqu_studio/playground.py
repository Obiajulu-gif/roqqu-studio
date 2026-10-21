"""Roqqu API playground: try any documented Roqqu endpoint from the studio.

The catalog (`integrations/roqqu/endpoints.json`) is generated from the
OpenAPI blocks on developers.roqqu.com and covers every endpoint there. Calls
go through this server so the secret key never reaches a browser, and only
catalog entries can be called (no free-form URLs).

Safety tiers:
  * public reads (no auth): always allowed
  * authorised reads: need ROQQU_SECRET_KEY
  * side effects (money moves, paid lookups, wallet create/delete): also need
    ALLOW_PRODUCTION_EXECUTION=true, because Roqqu has no sandbox
"""

from __future__ import annotations

import json
import re
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, Field

from .config import Settings
from .integrations.roqqu.client import RoqquError, claim_address_lookup
from .observability import register_secret

_CATALOG = Path(__file__).parent / "integrations" / "roqqu" / "endpoints.json"
_SIDE_EFFECTS = {"generate-wallet", "delete-wallet"}
_TOKEN_RE = re.compile(r"^[a-z]{2,6}$")


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
    return bool(e["moves_money"] or e["paid_lookup"] or e["id"] in _SIDE_EFFECTS)


def _coerce(value: Any, kind: str) -> Any:
    if kind in ("number", "integer") and isinstance(value, str) and value.strip():
        try:
            return int(value) if kind == "integer" else float(value)
        except ValueError:
            raise PlaygroundError(400, f"{value!r} is not a number") from None
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
            if not _TOKEN_RE.match(str(value)):
                raise PlaygroundError(400, f"{p['name']} must be a coin symbol like eth")
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
                422, "This endpoint needs your Roqqu secret key. Set ROQQU_SECRET_KEY on the API."
            )
        register_secret(settings.roqqu_secret_key)
        headers["Authorization"] = f"Bearer {settings.roqqu_secret_key}"
    if has_side_effects(e) and not settings.allow_production_execution:
        raise PlaygroundError(
            422,
            "This call changes real money or wallets, and Roqqu has no sandbox. "
            "Set ALLOW_PRODUCTION_EXECUTION=true on the API to allow it.",
        )
    if e["id"] == "address-lookup":
        try:
            claim_address_lookup()
        except RoqquError as exc:
            raise PlaygroundError(429, str(exc)) from None

    base = settings.roqqu_base_url.rstrip("/")
    started = time.monotonic()
    try:
        with httpx.Client(timeout=20.0, transport=transport) as http:
            resp = http.request(method, base + path, params=query or None,
                                json=body if method != "GET" else None, headers=headers)
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
