"""Business services on Roqqu: the working panels behind each template.

Every action maps to a documented Roqqu endpoint (via the playground's
allowlisted call). Two modes:

  * practice - no keys, no money. Inputs are checked the way Roqqu checks them
    and the answer is simulated in Roqqu's documented response shape. Every
    practice result is labelled as such; practice prices are not market data.
  * live     - the real Roqqu API with the server's key. Side effects still
    need ALLOW_PRODUCTION_EXECUTION=true (enforced by the playground).

Each session keeps a short history so the dashboard shows what happened.
KYC answers are reduced to a name and a masked number: the rest of the record
(date of birth, phone, address) never leaves this module.
"""

from __future__ import annotations

import re
import secrets
from collections import defaultdict, deque
from datetime import datetime, timezone
from decimal import Decimal, ROUND_UP
from typing import Any, Literal

from pydantic import BaseModel, Field

from . import playground
from .config import Settings

Mode = Literal["practice", "live"]

# action -> (playground endpoint id, panel)
ACTIONS: dict[str, tuple[str, str]] = {
    "verify-meter": ("verify-meter", "bills"),
    "pay-electricity": ("pay-electricity", "bills"),
    "recharge-airtime": ("recharge-airtime", "bills"),
    "data-bundles": ("data-bundles", "data"),
    "buy-data": ("buy-data", "data"),
    "check-address": ("address-lookup", "withdraw"),
    "send-token": ("send-token", "withdraw"),
    "bvn-verify": ("bvn-verify", "kyc"),
    "nin-verify": ("nin-verify", "kyc"),
    "get-banks": ("get-banks", "kyc"),
    "account-resolve": ("account-resolve", "kyc"),
    "get-prices": ("get-prices", "alerts"),
}

ADDRESS_RE = {
    "btc": re.compile(r"^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$"),
    "eth": re.compile(r"^0x[a-fA-F0-9]{40}$"),
    "trx": re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$"),
}
PHONE_RE = re.compile(r"^0[789][01]\d{8}$")

# Practice fixtures, labelled as practice data wherever they are shown.
PRACTICE_PRICES = {
    "btc": {"price": 68000.0, "change": 1.8},
    "eth": {"price": 3500.0, "change": -0.6},
    "trx": {"price": 0.25, "change": 0.4},
    "bnb": {"price": 590.0, "change": 0.9},
    "xrp": {"price": 0.55, "change": -1.2},
    "usdt": {"price": 1.0, "change": 0.0},
}
PRACTICE_PLANS = {
    "mtn": [("mtn-100mb-100", "N100 100MB - 1 day", "100.00"),
            ("mtn-1gb-500", "N500 1GB - 7 days", "500.00"),
            ("mtn-2gb-1200", "N1,200 2GB - 30 days", "1200.00"),
            ("mtn-10gb-3500", "N3,500 10GB - 30 days", "3500.00")],
    "airtel": [("airtel-100mb-100", "N100 100MB - 1 day", "100.00"),
               ("airtel-1-5gb-1000", "N1,000 1.5GB - 30 days", "1000.00"),
               ("airtel-6gb-2500", "N2,500 6GB - 30 days", "2500.00")],
    "glo": [("glo-1gb-500", "N500 1GB - 14 days", "500.00"),
            ("glo-5-8gb-2000", "N2,000 5.8GB - 30 days", "2000.00")],
    "etisalat": [("9mobile-1gb-1000", "N1,000 1GB - 30 days", "1000.00"),
                 ("9mobile-4-5gb-2000", "N2,000 4.5GB - 30 days", "2000.00")],
}
PRACTICE_BANKS = [
    "Access Bank", "Ecobank Nigeria", "Fidelity Bank Plc", "First Bank of Nigeria",
    "First City Monument Bank", "Guaranty Trust Bank", "Kuda Microfinance Bank", "Moniepoint MFB",
    "Opay", "Palmpay", "Polaris Bank", "Stanbic IBTC Bank", "Sterling Bank", "Union Bank",
    "United Bank for Africa", "Wema Bank", "Zenith Bank",
]


class ServiceRequest(BaseModel):
    action: str
    params: dict[str, Any] = Field(default_factory=dict)
    mode: Mode = "practice"


class PayrollRow(BaseModel):
    name: str
    wallet: str
    amount_ngn: Decimal = Field(gt=0)


class PayrollRequest(BaseModel):
    token: Literal["btc", "eth", "trx"] = "trx"
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


def _mask(value: str) -> str:
    value = str(value or "")
    return f"{'•' * max(len(value) - 3, 0)}{value[-3:]}" if value else ""


def _fail(message: str) -> None:
    raise ServiceError(400, message)


# --- practice simulation ------------------------------------------------------

def _simulate(action: str, p: dict[str, Any]) -> Any:
    """Roqqu-shaped answers, with Roqqu's own input checks applied."""
    if action == "verify-meter":
        if not re.fullmatch(r"\d{11,13}", str(p.get("meter_number", ""))):
            _fail("invalid meter number")
        return {"cust_name": "MRS ADA OKAFOR (practice)", "address": "12 Sample Street, Ikeja"}
    if action == "pay-electricity":
        amount = Decimal(str(p.get("amount") or 0))
        if amount < 500:
            _fail("minimum electricity purchase is NGN 500")
        units = ((amount - 100) / Decimal("68")).quantize(Decimal("0.1"))
        token = "-".join(f"{secrets.randbelow(10000):04d}" for _ in range(5))
        return {"token": token, "units_kwh": str(units), "fee_ngn": "100"}
    if action == "recharge-airtime":
        if not PHONE_RE.match(str(p.get("phone_number", ""))):
            _fail("invalid phone number supplied")
        return None
    if action == "data-bundles":
        plans = PRACTICE_PLANS.get(str(p.get("provider", "")).lower())
        if plans is None:
            _fail("unable to get subscriptions")
        return [
            {"variation_code": c, "name": n, "variation_amount": a, "fixedPrice": "Yes"}
            for c, n, a in plans
        ]
    if action == "buy-data":
        if not PHONE_RE.match(str(p.get("phone_number", ""))):
            _fail("invalid phone number supplied")
        return {"request_id": str(secrets.randbelow(900000) + 100000),
                "phone": p.get("phone_number"), "variation_code": p.get("variation_code")}
    if action == "check-address":
        symbol = str(p.get("symbol", "")).lower()
        if not ADDRESS_RE.get(symbol, re.compile(r"^$")).match(str(p.get("addr", ""))):
            _fail(f"invalid {symbol.upper() or 'coin'} address supplied")
        return {"address": p.get("addr"), "symbol": symbol, "balance": 0, "transactions": []}
    if action == "send-token":
        symbol = str(p.get("token", "")).lower()
        if not ADDRESS_RE.get(symbol, re.compile(r"^$")).match(str(p.get("wallet", ""))):
            _fail(f"invalid {symbol.upper() or 'coin'} address supplied")
        if Decimal(str(p.get("amount") or 0)) <= 0:
            _fail("amount must be more than zero")
        return None
    if action in ("bvn-verify", "nin-verify"):
        key = "bvn" if action == "bvn-verify" else "nin"
        if not re.fullmatch(r"\d{11}", str(p.get(key, ""))):
            _fail(f"invalid {key.upper()} supplied")
        return {key: p[key], "first_name": "ADA", "middle_name": "CHIOMA", "last_name": "OKAFOR"}
    if action == "get-banks":
        return PRACTICE_BANKS
    if action == "account-resolve":
        if not re.fullmatch(r"\d{10}", str(p.get("account_number", ""))):
            _fail("invalid account details")
        if not p.get("bank"):
            _fail("pick a bank")
        return "ADA CHIOMA OKAFOR (practice)"
    if action == "get-prices":
        return PRACTICE_PRICES
    raise ServiceError(404, f"unknown action: {action}")


# --- shaping what the browser sees --------------------------------------------

def _shape(action: str, data: Any) -> Any:
    if action in ("bvn-verify", "nin-verify") and isinstance(data, dict):
        key = "bvn" if action == "bvn-verify" else "nin"
        name = " ".join(str(data.get(k) or "") for k in ("first_name", "middle_name", "last_name"))
        return {"name": " ".join(name.split()), key: _mask(data.get(key, ""))}
    return data


def _summary(action: str, p: dict[str, Any], data: Any) -> str:
    match action:
        case "verify-meter":
            return f"Meter {p.get('meter_number')} belongs to {data.get('cust_name', '?')}"
        case "pay-electricity":
            return f"Bought NGN {p.get('amount')} of electricity for meter {p.get('meter_number')}"
        case "recharge-airtime":
            return f"Sent NGN {p.get('amount')} airtime to {p.get('phone_number')}"
        case "data-bundles":
            return f"Loaded {len(data or [])} {str(p.get('provider', '')).upper()} data plans"
        case "buy-data":
            return f"Activated {p.get('variation_code')} on {p.get('phone_number')}"
        case "check-address":
            return f"{str(p.get('symbol', '')).upper()} address {str(p.get('addr', ''))[:10]}… is valid"
        case "send-token":
            return f"Sent {p.get('amount')} {str(p.get('token', '')).upper()} to {str(p.get('wallet', ''))[:10]}…"
        case "bvn-verify" | "nin-verify":
            return f"{'BVN' if action == 'bvn-verify' else 'NIN'} verified for {data.get('name')}"
        case "get-banks":
            return f"Loaded {len(data or [])} banks"
        case "account-resolve":
            return f"Account {p.get('account_number')} at {p.get('bank')} is {data}"
        case "get-prices":
            return f"Loaded {len(data or {})} prices"
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
    shaped = _shape(req.action, data)
    entry = _record(session, panel, req.action, req.mode, True, _summary(req.action, params, shaped))
    return {"mode": req.mode, "data": shaped, "entry": entry}


def run_payroll(req: PayrollRequest, settings: Settings, session: str) -> dict[str, Any]:
    """Pay each row in crypto: address checked locally, amount priced at Roqqu's
    price (practice prices in practice), then one Send Token per row."""
    price_usd = Decimal(str(_prices(settings, req.mode)[req.token]["price"]))
    ngn_per_usd = Decimal(settings.roqqu_ngn_per_usd)
    results = []
    for row in req.rows:
        due = (row.amount_ngn / ngn_per_usd / price_usd).quantize(Decimal("0.00000001"), ROUND_UP)
        if not ADDRESS_RE[req.token].match(row.wallet.strip()):
            results.append({"name": row.name, "ok": False, "amount_token": str(due),
                            "message": f"Not a valid {req.token.upper()} address. Skipped."})
            continue
        try:
            run(ServiceRequest(action="send-token", mode=req.mode,
                               params={"token": req.token, "amount": str(due), "wallet": row.wallet.strip()}),
                settings, session)
            results.append({"name": row.name, "ok": True, "amount_token": str(due), "message": "Sent"})
        except ServiceError as exc:
            results.append({"name": row.name, "ok": False, "amount_token": str(due), "message": exc.detail})
    paid = sum(1 for r in results if r["ok"])
    _record(session, "payroll", "pay-staff", req.mode, paid == len(results),
            f"Paid {paid} of {len(results)} staff in {req.token.upper()}")
    return {"mode": req.mode, "token": req.token, "price_usd": str(price_usd), "results": results}


def _prices(settings: Settings, mode: Mode) -> dict[str, Any]:
    if mode == "practice":
        return PRACTICE_PRICES
    res = playground.call(playground.PlaygroundCall(endpoint="get-prices", params={}), settings)
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
            "production_allowed": settings.allow_production_execution,
            "ngn_per_usd": settings.roqqu_ngn_per_usd}
