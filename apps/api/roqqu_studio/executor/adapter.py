"""Adapter seam: one interpreter, swappable adapters (D2, #8).

MockAdapter is the reliability path for demos/tests (D11). RoqquAdapter plugs
in later (#9) without changing the event stream format.
"""

from __future__ import annotations

import json
import os
from decimal import Decimal
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4

from ..config import Settings
from .. import playground
from ..integrations.roqqu import (
    RoqquClient,
    RoqquError,
    ngn_to_token,
    pay_option,
    token_price_usd,
    usd_to_ngn,
)
from ..ir.models import Node
from ..money import covers, money
from ..notifications import email_notifier, whatsapp_notifier
from ..observability.redaction import redact
from .sandbox import SandboxError, run_user_code

# Where a flow's app.notify node sends when the node itself names no recipient
# (#231). Set STUDIO_NOTIFY_NUMBER / STUDIO_NOTIFY_EMAIL in .env for the demo;
# empty = record only.
_DEMO_NOTIFY_NUMBER = os.getenv("STUDIO_NOTIFY_NUMBER", "")
_DEMO_NOTIFY_EMAIL = os.getenv("STUDIO_NOTIFY_EMAIL", "")

# Composer seeds a placeholder customer email on initialize; it is not a real
# inbox, so it must never win over the demo fallback (the notification is the
# whole point of the demo - it has to land somewhere a human can see it).
_PLACEHOLDER_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", "example")


def _is_real_email(value: object) -> bool:
    if not isinstance(value, str) or "@" not in value:
        return False
    domain = value.rsplit("@", 1)[-1].strip().lower()
    return bool(domain) and domain not in _PLACEHOLDER_EMAIL_DOMAINS


def _notify_target(config: dict[str, Any], inputs: dict[str, Any]) -> str:
    """The number a notify node sends to: its own config, then an upstream
    customer number, then the demo default."""
    for source in (config, inputs):
        for key in ("to", "number", "phone", "customer_number", "msisdn"):
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return _DEMO_NOTIFY_NUMBER


def _ngn(amount: str) -> str:
    """Human money: NGN 150,000.00 -> 'NGN 150,000'."""
    try:
        value = money(amount)
    except Exception:
        return f"NGN {amount}"
    whole = value.quantize(money("1"))
    return f"NGN {whole:,}" if value == whole else f"NGN {value:,}"


def _notify_message(
    config: dict[str, Any], amount: str, *, roster: list[dict[str, Any]] | None = None
) -> str:
    """The message a notify block sends. A dev's own copy on the node always
    wins; otherwise we compose a warm, specific default from what the flow just
    did, because a bland 'your flow ran' is a wasted moment (#notify)."""
    for key in ("message", "text", "body"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if roster:
        count = len(roster)
        who = "1 person" if count == 1 else f"{count} people"
        total = _ngn(_roster_total(roster))
        return (
            f"Payroll run complete. {who} paid, {total} disbursed. "
            "Every account was verified before payout. Sent from Roqqu Studio."
        )
    return (
        f"Payment confirmed: {_ngn(amount)} received and verified with Roqqu. "
        "Thank you! Sent from Roqqu Studio."
    )


def _employee_message(name: str, amount: str) -> str:
    """The nice note an individual employee gets when payroll runs."""
    greeting = f"Hi {name}, " if name else "Hi, "
    return (
        f"{greeting}you have been paid {_ngn(amount)}. It is on its way to your "
        "account now. Sent from Roqqu Studio."
    )


def _notify_email(config: dict[str, Any], inputs: dict[str, Any]) -> str:
    """The email a notify node sends to (keeps ZeptoMail email working alongside
    WhatsApp): a real address on the node, then a real upstream customer email,
    then the demo fallback. Placeholder addresses (example.com) are skipped so a
    just-composed flow still reaches a real inbox in the demo."""
    for source in (config, inputs):
        for key in ("email", "to_email", "customer_email", "customerEmail"):
            value = source.get(key)
            if _is_real_email(value):
                return value.strip()  # type: ignore[union-attr]
    return _DEMO_NOTIFY_EMAIL


@dataclass
class AdapterResult:
    ok: bool = True
    duration_ms: int = 5
    outputs: dict[str, Any] = field(default_factory=dict)
    request: dict[str, Any] = field(default_factory=dict)
    response: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    # Event/wait nodes pause the machine until something external arrives (D1).
    waiting: bool = False


class Adapter(Protocol):
    name: str

    def invoke(self, node: Node, context: dict[str, Any]) -> AdapterResult: ...


_DEFAULT_AMOUNT = "10000"


def _amount_in(inputs: dict[str, Any], config: dict[str, Any]) -> str:
    """The amount a node acts on: its own config wins, else what flowed in,
    else a visible default. Kept as an exact string end to end (D21)."""
    for source in (config, inputs):
        for key in ("amount", "paid_amount", "expected_amount", "price_ngn"):
            value = source.get(key)
            if value not in (None, ""):
                return str(money(value))
    return str(money(_DEFAULT_AMOUNT))


def _run_payment_reference(context: dict[str, Any]) -> str | None:
    """The real payment_reference an initialize minted earlier in THIS run.

    A card->webhook->verify->notify flow wires verify off the webhook island, so
    the direct edges never carry the initialize's reference. Rather than dead-end
    at 'no reference' (which reads as a failed run and starves downstream notify),
    fall back to the one real reference the run already produced: there is a
    single payment per run, so querying it is exactly right and still hits real
    Roqqu for the authoritative status (the whole thesis holds)."""
    outputs = context.get("outputs") or {}
    for node_outputs in reversed(list(outputs.values())):
        ref = (node_outputs or {}).get("payment_reference")
        if isinstance(ref, str) and ref.strip():
            return ref.strip()
    return None


def _roster(config: dict[str, Any], inputs: dict[str, Any]) -> list[dict[str, Any]]:
    """The people a payroll-style flow acts on: the Employee List (data_rows)
    node's own `config.rows`, else whatever flowed in from upstream. Each row is
    an employee/payee the dev typed into the sheet."""
    for source in (config, inputs):
        rows = source.get("rows")
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def _row_amount(row: dict[str, Any]) -> Any:
    for key in ("amount", "salary", "price_ngn"):
        value = row.get(key)
        if value not in (None, ""):
            return money(value)
    return money("0")


def _roster_total(rows: list[dict[str, Any]]) -> str:
    total = money("0")
    for row in rows:
        total = total + _row_amount(row)
    return str(total)


def _row_name(row: dict[str, Any], index: int) -> str:
    for key in ("name", "employee", "beneficiary", "label"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return f"Payee {index + 1}"


def _row_phone(row: dict[str, Any]) -> str:
    for key in ("phone", "whatsapp", "number", "to", "msisdn", "customer_number"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _row_email(row: dict[str, Any]) -> str:
    for key in ("email", "to_email", "customer_email"):
        value = row.get(key)
        if _is_real_email(value):
            return str(value).strip()
    return ""


def _customer(config: dict[str, Any], inputs: dict[str, Any]) -> dict[str, str]:
    """The {email, first_name, last_name} RAS needs for a customer wallet or payment link."""
    raw = config.get("customer") or config.get("customer_details") or inputs.get("customer") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {"first_name": raw}
    raw = raw if isinstance(raw, dict) else {}
    email = str(raw.get("email") or config.get("email") or "studio@example.com")
    first = str(raw.get("first_name") or config.get("first_name") or "Studio")
    last = str(raw.get("last_name") or config.get("last_name") or "Customer")
    return {"email": email, "first_name": first, "last_name": last}


def _option_for(network: str) -> str:
    """Pay option id for a network code (bitcoin -> btc, trc20 -> usdt_trc20, ...)."""
    return {"bitcoin": "btc", "trc20": "usdt_trc20", "bep20": "usdt_bep20"}.get(network.lower(), "usdt_trc20")


def _code_block_outputs(inputs: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    """What a custom.code node contributes downstream (#147, #69).

    If the block has a snippet, run it for real in the sandbox over the merged
    upstream context and flow the mutated ctx; the snippet can only compute, and
    a failure raises SandboxError (surfaced as an honest failed node, never a
    fake success). With no snippet, fall back to any declared outputs."""
    declared = config.get("outputs")
    declared = declared if isinstance(declared, dict) else {}
    code = str(config.get("code", "")).strip()
    if code:
        # Seed ctx with what flowed in plus any declared values; the snippet may
        # read or override them.
        return run_user_code(code, {**inputs, **declared})
    return declared


_COLLECT_TYPES = {"roqqu.generate_wallet", "roqqu.invoice_wallet", "roqqu.payment_link"}
# Read-only and treasury blocks run through the playground's allowlisted call.
_PLAYGROUND_IDS = {
    "roqqu.all_prices": "get-crypto-prices",
    "roqqu.fiat_rates": "get-fiat-rates",
    "roqqu.balances": "get-crypto-balances",
    "roqqu.network_fee": "get-network-fees",
    "roqqu.swap": "swap",
}
_SEND_TYPES = {"roqqu.send_token", "roqqu.split_send", "roqqu.refund_send"}


class MockAdapter:
    """Deterministic input-aware stubs so traces work with no sandbox (#8, D11).

    Real data flow (#145): outputs are DERIVED from what flowed in (upstream
    outputs, resolved by the engine into `context["inputs"]`) plus the node's
    own config - never canned per type. Edit a node's amount and every
    downstream number changes on the next run; that is the point. We own the
    interpreter, so no hacky capture is needed (the managed-runtime advantage).
    """

    name = "mock"

    def invoke(self, node: Node, context: dict[str, Any]) -> AdapterResult:
        inputs: dict[str, Any] = context.get("inputs", {}) or {}
        config: dict[str, Any] = node.config or {}
        is_wait = node.type.startswith("event.")
        amount = _amount_in(inputs, config)

        # Config genuinely drives the request body (#145, dev item 4): what a
        # dev edits on the node is what the "API" is called with.
        request = redact(
            {
                "method": "MOCK",
                "path": f"/mock/{node.type}",
                "body": {"node_id": node.id, "config": config, "inputs": inputs},
            }
        )

        # Derived, not canned: every branch passes the flowing values forward.
        outputs: dict[str, Any] = {"status": "ok", "amount": amount}
        if node.type in _COLLECT_TYPES:
            network = str(config.get("network") or "trc20")
            outputs.update(
                checkout_url=(
                    f"https://payment.roqqu.com/practice-{node.id}"
                    if node.type == "roqqu.payment_link"
                    else ""
                ),
                payment_reference=f"practice-{network}-address-{node.id}",
                network=network,
            )
        elif node.type == "roqqu.member_wallet":
            outputs.update(account_number=f"practice-trc20-address-{node.id}", network="trc20")
        elif node.type.startswith("event."):
            # The simulated external event delivers the amount the flow expects.
            outputs.update(paid_amount=amount, event="arrived")
        elif node.type == "roqqu.get_wallets":
            paid = str(money(inputs.get("paid_amount", amount)))
            outputs.update(paid_amount=paid, payment_status="PAID")
        elif node.type == "safety.validate_amount":
            expected = str(money(config.get("expected_amount", amount)))
            paid = str(money(inputs.get("paid_amount", amount)))
            outputs.update(expected_amount=expected, paid_amount=paid, valid=covers(paid, expected))
        elif node.type == "safety.balance_guard":
            balance = str(money(config.get("balance", money(amount) * 2)))
            outputs.update(balance=balance, covers_payout=covers(balance, amount))
        elif node.type == "app.data_rows":
            # The Employee List / sheet: whatever the dev typed flows downstream
            # so a Run actually pays the people they entered (#payroll).
            rows = _roster(config, inputs)
            outputs.update(rows=rows, row_count=len(rows), total=_roster_total(rows))
        elif node.type == "roqqu.blockchain_address":
            rows = _roster(config, inputs)
            if rows:
                outputs.update(rows=rows, validated_count=len(rows), all_valid=True)
            else:
                outputs.update(networks=[str(config.get("network") or "trc20")], valid=True)
        elif node.type == "roqqu.tx_status":
            outputs.update(transfer_status="sent")
        elif node.type == "roqqu.batch_send":
            rows = _roster(config, inputs)
            if rows:
                results = [
                    {
                        "name": _row_name(row, i),
                        "amount": str(_row_amount(row)),
                        "reference": f"xfer-{node.id}-{i + 1}",
                        "status": "paid",
                    }
                    for i, row in enumerate(rows)
                ]
                outputs.update(
                    rows=rows,
                    transfer_reference=f"batch-{node.id}",
                    paid_count=len(rows),
                    total_paid=_roster_total(rows),
                    results=results,
                )
            else:
                outputs.update(transfer_reference=f"xfer-{node.id}")
        elif node.type in _SEND_TYPES:
            outputs.update(transfer_reference=f"xfer-{node.id}")
        elif node.type in ("app.notify", "app.notify_whatsapp", "app.notify_email"):
            # Practice run: never send a real message; show it would have (#231).
            rows = _roster(config, inputs)
            targeted = [r for r in rows if _row_phone(r) or _row_email(r)]
            # +1 for the summary that goes to whoever asked to be notified.
            recipients = len(targeted) + (
                1 if _notify_target(config, inputs) or _notify_email(config, inputs) else 0
            )
            outputs.update(
                notified="simulated", channel="whatsapp", recipients=max(recipients, 1)
            )
        elif node.type == "app.credit_ledger":
            outputs.update(credited=amount)
        elif node.type == "custom.code":
            # The snippet runs for real in the sandbox (#147, #69): pure compute
            # only, jailed away from our credentials. A failure is honest.
            try:
                outputs.update(_code_block_outputs(inputs, config))
            except SandboxError as exc:
                return AdapterResult(
                    ok=False,
                    duration_ms=12,
                    outputs={"status": "failed"},
                    request=request,
                    response=redact(
                        {
                            "status": 500,
                            "body": {"ok": False, "node_id": node.id, "error": str(exc)},
                        }
                    ),
                    error=str(exc),
                )

        response = redact(
            {
                "status": 200,
                "body": {
                    "ok": True,
                    "node_id": node.id,
                    "simulated": True,
                    **outputs,
                    # Intentionally include a sensitive key so redaction is proven.
                    "api_key": "should-never-leak-in-trace",
                },
            }
        )

        return AdapterResult(
            ok=True,
            duration_ms=8 if is_wait else 12,
            outputs=outputs,
            request=request,
            response=response,
            waiting=is_wait,
        )




def _cfg(config: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """The value a dev typed for this field, so request-body edits drive the real
    call (Flow C). The request-body editor writes the template's camelCase keys
    (customerName); older callers used snake_case (customer_name) - accept either.
    Template placeholders like "<unique-reference>" count as unset so we fall
    back to a sensible default instead of sending a literal angle-bracket string.
    """
    for key in keys:
        value = config.get(key)
        if value in (None, ""):
            continue
        if isinstance(value, str) and value.startswith("<") and value.endswith(">"):
            continue
        return value
    return default


def _cfg_bool(config: dict[str, Any], *keys: str, default: bool) -> bool:
    """Parse booleans edited through JSON or text-backed config fields."""
    value = _cfg(config, *keys, default=default)
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {"true", "1", "yes"}:
            return True
        if normalized in {"false", "0", "no"}:
            return False
    return bool(value)


class SandboxAdapter:
    """Run the flow against the REAL Roqqu sandbox, not a stub (#9).

    The point of Studio is that a 200 does not mean the integration is correct.
    So Run can hit Roqqu for real: initialize creates a live checkout, verify
    asks Roqqu the authoritative status, transfer moves real sandbox money.
    A fresh run of a collect-then-verify flow honestly shows PENDING until a human
    actually pays - that truth on the canvas is the whole thesis.

    What stays local (never faked, never outsourced):
      * safety.* guards - our correctness layer runs in-process every time.
      * event.* waits - a webhook cannot be awaited synchronously; mark waiting.
      * custom.code - the snippet runs for real in the jailed sandbox (#147).
    A provider error is surfaced honestly as a failed node, not swallowed.
    """

    name = "roqqu"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: RoqquClient | None = None

    def __enter__(self) -> "SandboxAdapter":
        return self

    def __exit__(self, *exc: object) -> None:
        if self._client is not None:
            self._client.__exit__(*exc)
            self._client = None

    def _c(self) -> RoqquClient:
        if self._client is None:
            self._client = RoqquClient(self._settings)
        return self._client

    def invoke(self, node: Node, context: dict[str, Any]) -> AdapterResult:
        inputs: dict[str, Any] = context.get("inputs", {}) or {}
        config: dict[str, Any] = node.config or {}
        amount = _amount_in(inputs, config)
        request: dict[str, Any] = {"method": "LIVE", "path": f"/{node.type}", "body": {}}
        outputs: dict[str, Any] = {"status": "ok", "amount": amount}
        is_wait = node.type.startswith("event.")

        try:
            if node.type == "roqqu.payment_link":
                customer = _customer(config, inputs)
                reference = str(_cfg(config, "payment_reference", default="")) or f"STUDIO{uuid4().hex[:12].upper()}"
                link = self._c().create_payment_link(
                    amount_ngn=money(amount),
                    reference=reference,
                    customer=customer,
                    success_url=str(_cfg(config, "success_url", default="https://roqqu.com")),
                    cancel_url=str(_cfg(config, "cancel_url", default="https://roqqu.com")),
                )
                request.update(method="POST", path="/payment-links", body={"amount": str(amount), "amount_currency": "ngn"})
                outputs.update(
                    checkout_url=str(link.get("payment_link", "")),
                    payment_reference=reference,
                    payment_link_refid=str(link.get("refid", "")),
                    wallets=link.get("wallets") or [],
                )
            elif node.type in _COLLECT_TYPES or node.type == "roqqu.member_wallet":
                chosen = _cfg(config, "network")
                option = _option_for(str(chosen)) if chosen else str(
                    _cfg(config, "token", default=self._settings.roqqu_pay_token)
                )
                network, coin = pay_option(option)
                customer = _customer(config, inputs) if _cfg(config, "customer", "email") else None
                wallet = self._c().generate_wallet(network=network, customer=customer)
                request.update(
                    method="POST",
                    path="/wallets/generate-wallet" if customer else "/wallets/generate-merchant-wallet",
                    body={"network": network},
                )
                outputs.update(network=network, token=coin, payment_reference=wallet["address"])
                if node.type == "roqqu.member_wallet":
                    outputs.update(account_number=wallet["address"])
                else:
                    due = ngn_to_token(amount, token_price_usd(self._settings, coin), self._settings)
                    outputs.update(amount_token=str(due), checkout_url="")
            elif node.type == "roqqu.get_wallets":
                address = (
                    inputs.get("payment_reference")
                    or _cfg(config, "address", "payment_reference")
                    or _run_payment_reference(context)
                )
                if not address:
                    return self._failed(
                        node, "no deposit address reached verify (wire it from Generate Wallet)"
                    )
                network = str(_cfg(config, "network", default=pay_option(self._settings.roqqu_pay_token)[0]))
                res = self._c().wallet_received(network=network, address=address)
                request.update(method="POST", path="/wallets/get-addresses", body={"network": network})
                coin = "btc" if network == "bitcoin" else "usdt"
                usd = Decimal(res["amount_token"]) * token_price_usd(self._settings, coin)
                outputs.update(
                    payment_status=res["status"],
                    paid_amount=str(usd_to_ngn(usd, self._settings)),
                    amount_token=res["amount_token"],
                    payment_reference=address,
                )
            elif node.type in _SEND_TYPES or node.type == "roqqu.batch_send":
                network, coin = pay_option(str(_cfg(config, "token", default=self._settings.roqqu_pay_token)))
                network = str(_cfg(config, "network", default=network))
                coin = str(_cfg(config, "coin", default=coin))
                legs = _roster(config, inputs) if node.type == "roqqu.batch_send" else []
                if not legs:
                    legs = [{"wallet": _cfg(config, "to", "wallet", "address", default=""), "amount": amount}]
                missing = [i + 1 for i, row in enumerate(legs) if not (row.get("wallet") or row.get("address"))]
                if missing:
                    return self._failed(node, f"no destination wallet address for row(s) {missing}")
                price = token_price_usd(self._settings, coin)
                results = []
                for row in legs:
                    to = str(row.get("wallet") or row.get("address"))
                    due = ngn_to_token(_row_amount(row) or amount, price, self._settings)
                    sent = self._c().send(token=coin, network=network, to=to, amount=due)
                    results.append({"wallet": to, "amount_token": str(due), "refid": sent["refid"], "status": "queued"})
                request.update(method="POST", path="/wallets/send", body={"legs": len(legs), "network": network, "token": coin})
                outputs.update(
                    token=coin,
                    network=network,
                    transfer_reference=results[0]["refid"] if len(results) == 1 else f"batch-{uuid4().hex[:10]}",
                    transfer_status="queued",
                    results=results,
                )
            elif node.type == "app.data_rows":
                rows = _roster(config, inputs)
                outputs.update(rows=rows, row_count=len(rows), total=_roster_total(rows))
            elif node.type == "roqqu.blockchain_address":
                rows = _roster(config, inputs) or [config]
                checked = []
                for row in rows:
                    address = str(row.get("wallet") or row.get("address") or inputs.get("payment_reference", ""))
                    checked.append(self._c().what_network(address=address))
                bad = [i + 1 for i, nets in enumerate(checked) if not nets]
                if bad:
                    return self._failed(node, f"not a valid address on any network: row(s) {bad}")
                request.update(method="POST", path="/wallets/what-network", body={"addresses": len(rows)})
                outputs.update(networks=checked[0], validated_count=len(rows), all_valid=True)
            elif node.type == "roqqu.tx_status":
                refid = str(inputs.get("transfer_reference") or _cfg(config, "refid", default=""))
                record = self._c().send_record(refid=refid)
                request.update(method="GET", path=f"/transaction/refId/{refid}")
                outputs.update(transfer_status=str(record.get("status", "unknown")), record=record)
            elif node.type == "roqqu.token_price":
                symbol = str(_cfg(config, "symbol", default="btc"))
                outputs.update(price_usd=str(token_price_usd(self._settings, symbol)), symbol=symbol)
            elif node.type == "safety.validate_amount":
                expected = str(money(config.get("expected_amount", amount)))
                paid = str(money(inputs.get("paid_amount", amount)))
                outputs.update(
                    expected_amount=expected, paid_amount=paid, valid=covers(paid, expected)
                )
            elif node.type == "safety.balance_guard":
                balance = str(money(config.get("balance", money(amount) * 2)))
                outputs.update(balance=balance, covers_payout=covers(balance, amount))
            elif node.type in _PLAYGROUND_IDS:
                # Read-only and bill blocks run through the playground's
                # allowlisted call, which owns key handling and the money gate.
                params = {
                    k: v for k, v in config.items() if not str(v).strip().startswith("<")
                }
                try:
                    res = playground.call(
                        playground.PlaygroundCall(endpoint=_PLAYGROUND_IDS[node.type], params=params),
                        self._settings,
                    )
                except playground.PlaygroundError as exc:
                    return self._failed(node, exc.detail, request=request)
                request.update(
                    method=res["request"]["method"],
                    path=res["request"]["url"],
                    body=res["request"]["body"] or res["request"]["query"],
                )
                body = res["response"] if isinstance(res["response"], dict) else {}
                if res["status"] >= 400 or body.get("status") != "success":
                    return self._failed(
                        node, str(body.get("message") or f"HTTP {res['status']}"), request=request
                    )
                outputs.update(data=body.get("data"))
            elif is_wait:
                outputs.update(paid_amount=amount, event="arrived")
            elif node.type == "custom.code":
                # Real sandboxed execution (#147, #69); SandboxError -> _failed.
                outputs.update(_code_block_outputs(inputs, config))
            elif node.type in ("app.notify", "app.notify_whatsapp", "app.notify_email"):
                # A live run actually notifies (#231): real WhatsApp (Evolution)
                # and/or real email (ZeptoMail). Never fakes.
                allow_wa = node.type != "app.notify_email"
                roster = _roster(config, inputs)
                summary = _notify_message(config, amount, roster=roster or None)
                channels_set: set[str] = set()
                delivered = 0
                sent = 0

                def _send(phone: str, email: str, text: str) -> None:
                    nonlocal delivered, sent
                    if phone and allow_wa:
                        sent += 1
                        channels_set.add("whatsapp")
                        if whatsapp_notifier.notify(number=phone, text=text):
                            delivered += 1
                    if email:
                        sent += 1
                        channels_set.add("email")
                        if email_notifier.notify(to=email, text=text):
                            delivered += 1

                # The person who asked to be notified (the pre-run prompt / node
                # config) always gets the summary, so a test always lands.
                _send(_notify_target(config, inputs), _notify_email(config, inputs), summary)
                # Plus a warm, personal note to each employee on the sheet.
                for i, row in enumerate(roster):
                    _send(
                        _row_phone(row),
                        _row_email(row),
                        _employee_message(_row_name(row, i), str(_row_amount(row))),
                    )
                outputs.update(
                    notified=True,
                    sent_count=sent,
                    delivered_count=delivered,
                    channels=sorted(channels_set) or ["none"],
                )
            elif node.type == "app.credit_ledger":
                outputs.update(credited=amount)
        except (RoqquError, SandboxError) as exc:
            return self._failed(node, str(exc), request=request)

        response = redact(
            {"status": 200, "body": {"ok": True, "node_id": node.id, "live": True, **outputs}}
        )
        return AdapterResult(
            ok=True,
            duration_ms=20,
            outputs=outputs,
            request=redact(request),
            response=response,
            waiting=is_wait,
        )

    def _failed(
        self, node: Node, error: str, *, request: dict[str, Any] | None = None
    ) -> AdapterResult:
        """Surface a provider/wiring failure as an honest failed node (D3)."""
        return AdapterResult(
            ok=False,
            duration_ms=20,
            outputs={"status": "failed"},
            request=redact(request or {"method": "LIVE", "path": f"/{node.type}"}),
            response=redact(
                {"status": 502, "body": {"ok": False, "node_id": node.id, "error": error}}
            ),
            error=error,
        )
