"""Business services on Roqqu: the working panels behind each template.

Every action maps to a documented Roqqu API Service endpoint (via the
playground's allowlisted call). Two modes:

  * practice - no keys, no money. Inputs are checked the way RAS checks them
    and the answer is simulated in RAS's documented response shape. Every
    practice result is labelled as such; practice prices are not market data.
  * live     - the real RAS API with the server's key (test key = test mode,
    no real money). Live-mode side effects still need
    ALLOW_PRODUCTION_EXECUTION=true (enforced by the playground).

Each session keeps a short history so the dashboard shows what happened.
"""

from __future__ import annotations

import re
import secrets
from collections import defaultdict, deque
from datetime import datetime, timezone
from decimal import ROUND_UP, Decimal
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import playground
from .config import Settings
from .integrations.roqqu import PAY_OPTIONS, ngn_per_usd

Mode = Literal["practice", "live"]

# action -> (playground endpoint id, panel)
ACTIONS: dict[str, tuple[str, str]] = {
    "check-address": ("what-network", "withdraw"),
    "send-coin": ("send-coin", "withdraw"),
    "network-fee": ("get-network-fees", "withdraw"),
    "balances": ("get-crypto-balances", "withdraw"),
    "get-prices": ("get-crypto-prices", "alerts"),
    "get-rates": ("get-fiat-rates", "alerts"),
}

# Which network an address shape belongs to (practice mode stands in for What Network).
ADDRESS_RE = {
    "bitcoin": re.compile(r"^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$"),
    "bep20": re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "erc20": re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "trc20": re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"),
}

# Practice fixtures, labelled as practice data wherever they are shown.
PRACTICE_PRICES = {
    "btc": {"price": 68000.0, "change": 1.8},
    "eth": {"price": 3500.0, "change": -0.6},
    "trx": {"price": 0.25, "change": 0.4},
    "bnb": {"price": 590.0, "change": 0.9},
    "xrp": {"price": 0.55, "change": -1.2},
    "usdt": {"price": 1.0, "change": 0.0},
}
PRACTICE_FEES = {"bitcoin": "0.00002", "trc20": "1", "bep20": "0.3", "erc20": "3"}


class ServiceRequest(BaseModel):
    action: str
    params: dict[str, Any] = Field(default_factory=dict)
    mode: Mode = "practice"


class PayrollRow(BaseModel):
    name: str
    wallet: str
    amount_ngn: Decimal = Field(gt=0)


class PayrollRequest(BaseModel):
    token: Literal["usdt_trc20", "usdt_bep20", "btc"] = "usdt_trc20"
    rows: list[PayrollRow] = Field(min_length=1, max_length=200)
    mode: Mode = "practice"


class AlertRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=8)
    direction: Literal["above", "below"]
    price_usd: Decimal = Field(gt=0)


class ServiceError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=60))
_alerts: dict[str, list[dict[str, Any]]] = defaultdict(list)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _fail(message: str) -> None:
    raise ServiceError(400, message)


def networks_for(address: str) -> list[str]:
    return [n for n, rx in ADDRESS_RE.items() if rx.match(address.strip())]


# --- practice simulation ------------------------------------------------------

def _simulate(action: str, p: dict[str, Any]) -> Any:
    """RAS-shaped answers, with RAS's own input checks applied."""
    if action == "check-address":
        nets = networks_for(str(p.get("address", "")))
        if not nets:
            _fail("cannot find any network for address parsed")
        return nets
    if action == "send-coin":
        network = str(p.get("network", "")).lower()
        if network not in networks_for(str(p.get("to", ""))):
            _fail("invalid network parsed for address")
        if Decimal(str(p.get("amount") or 0)) <= 0:
            _fail("amount must be greater than 0")
        return {"refid": str(secrets.randbelow(10**19) + 10**18)}
    if action == "network-fee":
        network = str(p.get("network", "")).lower()
        if network not in PRACTICE_FEES:
            _fail("network not supported")
        return {"fee": PRACTICE_FEES[network]}
    if action == "balances":
        return {"balance": {"btc": 0.0021, "eth": 0, "usdt": 137, "trx": 0}}
    if action == "get-prices":
        return PRACTICE_PRICES
    if action == "get-rates":
        return [{"symbol": "ngn", "title": "Nigerian Naira", "rate": 1360}]
    raise ServiceError(404, f"unknown action: {action}")


def _summary(action: str, p: dict[str, Any], data: Any) -> str:
    match action:
        case "check-address":
            return f"Address {str(p.get('address', ''))[:10]}… is on {', '.join(data or [])}"
        case "send-coin":
            refid = (data or {}).get("refid", "")
            return (f"Sent {p.get('amount')} {str(p.get('token', '')).upper()} on "
                    f"{str(p.get('network', '')).upper()} to {str(p.get('to', ''))[:10]}… (refid {refid})")
        case "network-fee":
            return f"{str(p.get('network', '')).upper()} network fee is {(data or {}).get('fee')}"
        case "balances":
            return "Loaded balances"
        case "get-prices":
            return f"Loaded {len(data or {})} prices"
        case "get-rates":
            return "Loaded fiat rates"
    return action


def _record(session: str, panel: str, action: str, mode: Mode, ok: bool, summary: str) -> dict:
    entry = {"id": secrets.token_hex(4), "at": _now(), "panel": panel, "action": action,
             "mode": mode, "ok": ok, "summary": summary}
    _history[session].appendleft(entry)
    return entry


def run(req: ServiceRequest, settings: Settings, session: str) -> dict[str, Any]:
    if req.action not in ACTIONS:
        raise ServiceError(404, f"unknown action: {req.action}")
    endpoint, panel = ACTIONS[req.action]
    params = {k: v for k, v in req.params.items() if v not in (None, "")}
    try:
        if req.mode == "live":
            res = playground.call(playground.PlaygroundCall(endpoint=endpoint, params=params), settings)
            body = res["response"] if isinstance(res["response"], dict) else {}
            if res["status"] >= 400 or body.get("status") != "success":
                _fail(str(body.get("message") or f"Roqqu answered HTTP {res['status']}"))
            data = body.get("data")
        else:
            playground.build_request(playground._endpoint(endpoint), params)  # same required fields
            data = _simulate(req.action, params)
    except playground.PlaygroundError as exc:
        _record(session, panel, req.action, req.mode, False, exc.detail)
        raise ServiceError(exc.status, exc.detail) from None
    except ServiceError as exc:
        _record(session, panel, req.action, req.mode, False, exc.detail)
        raise
    entry = _record(session, panel, req.action, req.mode, True, _summary(req.action, params, data))
    return {"mode": req.mode, "data": data, "entry": entry}


def run_payroll(req: PayrollRequest, settings: Settings, session: str) -> dict[str, Any]:
    """Pay each row in crypto: address checked against the network, amount priced at
    Roqqu's price and NGN rate (practice values in practice), then one Send per row."""
    network, coin = PAY_OPTIONS[req.token]
    price_usd = Decimal(str(_prices(settings, req.mode)[coin]["price"]))
    rate = Decimal(1360) if req.mode == "practice" else ngn_per_usd(settings)
    results = []
    for row in req.rows:
        due = (row.amount_ngn / rate / price_usd).quantize(Decimal("0.00000001"), ROUND_UP)
        if network not in networks_for(row.wallet):
            results.append({"name": row.name, "ok": False, "amount_token": str(due),
                            "message": f"Not a {network.upper()} address. Skipped."})
            continue
        try:
            sent = run(ServiceRequest(action="send-coin", mode=req.mode,
                                      params={"token": coin, "network": network, "amount": str(due),
                                              "to": row.wallet.strip()}),
                       settings, session)
            results.append({"name": row.name, "ok": True, "amount_token": str(due),
                            "message": f"Queued (refid {(sent['data'] or {}).get('refid', '')})"})
        except ServiceError as exc:
            results.append({"name": row.name, "ok": False, "amount_token": str(due), "message": exc.detail})
    paid = sum(1 for r in results if r["ok"])
    _record(session, "payroll", "pay-staff", req.mode, paid == len(results),
            f"Paid {paid} of {len(results)} staff in {coin.upper()} ({network.upper()})")
    return {"mode": req.mode, "token": req.token, "price_usd": str(price_usd), "results": results}


def _prices(settings: Settings, mode: Mode) -> dict[str, Any]:
    if mode == "practice":
        return PRACTICE_PRICES
    res = playground.call(playground.PlaygroundCall(endpoint="get-crypto-prices", params={}), settings)
    body = res["response"] if isinstance(res["response"], dict) else {}
    if body.get("status") != "success":
        raise ServiceError(502, "Roqqu prices unavailable")
    return body["data"]


def prices_board(settings: Settings) -> dict[str, Any]:
    """Live prices when Roqqu answers, otherwise practice prices, clearly labelled."""
    try:
        return {"source": "live", "prices": _prices(settings, "live")}
    except (ServiceError, playground.PlaygroundError):
        return {"source": "practice", "prices": PRACTICE_PRICES}


def add_alert(session: str, req: AlertRequest) -> dict[str, Any]:
    alert = {"id": secrets.token_hex(4), "symbol": req.symbol.lower(), "direction": req.direction,
             "price_usd": str(req.price_usd), "created_at": _now(), "triggered_at": None,
             "last_price": None}
    _alerts[session].append(alert)
    _record(session, "alerts", "add-alert", "practice", True,
            f"Alert set: {alert['symbol'].upper()} {req.direction} ${req.price_usd}")
    return alert


def remove_alert(session: str, alert_id: str) -> None:
    _alerts[session] = [a for a in _alerts[session] if a["id"] != alert_id]


def check_alerts(session: str, settings: Settings) -> dict[str, Any]:
    board = prices_board(settings)
    for alert in _alerts[session]:
        row = board["prices"].get(alert["symbol"])
        if not row:
            continue
        price = Decimal(str(row["price"]))
        alert["last_price"] = str(price)
        level = Decimal(alert["price_usd"])
        crossed = price >= level if alert["direction"] == "above" else price <= level
        if crossed and not alert["triggered_at"]:
            alert["triggered_at"] = _now()
            _record(session, "alerts", "alert-fired", board["source"], True,
                    f"{alert['symbol'].upper()} is ${price}, {alert['direction']} ${level}")
    return {**board, "alerts": _alerts[session]}


def history(session: str, panel: str | None = None) -> list[dict[str, Any]]:
    return [h for h in _history[session] if panel in (None, h["panel"])]


def status(settings: Settings) -> dict[str, Any]:
    return {"live_key": bool(settings.roqqu_secret_key),
            "mode": settings.ras_mode,
            "production_allowed": settings.allow_production_execution,
            "ngn_per_usd": str(ngn_per_usd(settings))}
