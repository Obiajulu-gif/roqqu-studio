"""Roqqu API Service (RAS) client, built from https://roqqu-api-services.gitbook.io/ras.

Every endpoint lives under `https://service.roqqu.com/v1`. Calls carry the API key
in `x-api-key` (live) or `x-staging-api-key` (test mode, keys from the RAS console).
Responses share one envelope: `{"status": "success"|"fail", "message": ..., "data": ...}`.

Live calls move real crypto, so the settings guard refuses them unless
ALLOW_PRODUCTION_EXECUTION=true. Test mode is always allowed. The key is
registered with the log redactor so it never surfaces in a log or a trace.

Docs map:
  Wallets       POST /wallets/generate-wallet, /wallets/generate-merchant-wallet,
                /wallets/get-addresses, /wallets/get-wallet, /wallets/send,
                /wallets/what-network; DELETE /wallets/delete
  Payment links POST /payment-links; GET /payment-links/supported-networks
  Balances      POST /balances
  Transactions  GET  /transaction/status/:hash, /transaction/refId/:refid; POST /transaction/network-fee
  Market        GET  /prices, /rates (public)
  Webhooks      encrypted body {hash}, AES-256-CTR, IV in the x-api-key header
"""

from __future__ import annotations

import json
import time
from decimal import ROUND_UP, Decimal
from typing import Any

import httpx

from ...config import Settings
from ...observability import get_logger, register_secret, traced

log = get_logger("roqqu")

DOCS = "https://roqqu-api-services.gitbook.io/ras"
BASE_URL = "https://service.roqqu.com/v1"

# What a buyer can pay with: id -> (network, token). Payment links support exactly these.
PAY_OPTIONS: dict[str, tuple[str, str]] = {
    "usdt_trc20": ("trc20", "usdt"),
    "usdt_bep20": ("bep20", "usdt"),
    "btc": ("bitcoin", "btc"),
}
WALLET_TOKENS = tuple(PAY_OPTIONS)  # kept name: the coins a buyer can switch between
NETWORKS = ("bitcoin", "erc20", "bep20", "trc20", "solana", "ripple", "litecoin", "base", "dogecoin")


class RoqquError(RuntimeError):
    """A RAS request failed or returned status != success."""


def pay_option(option: str) -> tuple[str, str]:
    """(network, token) for a pay option id; accepts a bare token for older configs."""
    key = (option or "").strip().lower()
    if key in PAY_OPTIONS:
        return PAY_OPTIONS[key]
    legacy = {"usdt": "usdt_trc20", "trx": "usdt_trc20", "eth": "usdt_bep20", "bnb": "usdt_bep20"}
    if key in legacy:
        return PAY_OPTIONS[legacy[key]]
    raise RoqquError(f"pay with one of {', '.join(PAY_OPTIONS)}, not {option!r}")


def _form(payload: dict[str, Any]) -> dict[str, str]:
    """RAS takes form fields; nested values travel as JSON strings (per the docs)."""
    return {
        k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
        for k, v in payload.items()
        if v is not None
    }


class RoqquClient:
    """Thin RAS client. Use as a context manager."""

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None) -> None:
        if not settings.roqqu_secret_key:
            raise RoqquError("Roqqu key not configured: set RAS_TEST_KEY (or RAS_LIVE_KEY)")
        try:
            settings.assert_sandbox()
        except RuntimeError as exc:  # surface as a provider error (clean 502), not a 500
            raise RoqquError(str(exc)) from None
        register_secret(settings.roqqu_secret_key)
        self._settings = settings
        self._http = httpx.Client(
            base_url=settings.roqqu_base_url.rstrip("/"),
            timeout=20.0,
            transport=transport,
            headers={settings.ras_key_header: settings.roqqu_secret_key},
        )

    def __enter__(self) -> "RoqquClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self._http.close()

    def _call(self, method: str, path: str, *, form: dict[str, Any] | None = None, **kwargs: Any) -> Any:
        """Send one request and return the envelope's `data`."""
        if form is not None:
            kwargs["data"] = _form(form)
        try:
            resp = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:  # DNS, timeout, refused
            raise RoqquError(f"Roqqu unreachable: {type(exc).__name__}") from exc
        try:
            body = resp.json()
        except ValueError as exc:
            raise RoqquError(f"Non-JSON response from Roqqu (HTTP {resp.status_code})") from exc
        if resp.status_code >= 400 or body.get("status") != "success":
            raise RoqquError(body.get("message") or f"HTTP {resp.status_code}")
        return body.get("data")

    # --- Wallets ----------------------------------------------------------

    def generate_wallet(
        self, *, network: str, customer: dict[str, str] | None = None
    ) -> dict[str, Any]:
        """New deposit address on a network (POST /wallets/generate-wallet).

        RAS needs a customer (email, first_name, last_name); without one we create
        a merchant-owned address (POST /wallets/generate-merchant-wallet)."""
        with traced("roqqu.generate_wallet", network=network):
            if customer:
                data = self._call(
                    "POST", "/wallets/generate-wallet", form={"network": network, "customer": customer}
                )
            else:
                data = self._call("POST", "/wallets/generate-merchant-wallet", form={"network": network})
        address = (data or {}).get("address")
        if not address:
            raise RoqquError("Roqqu returned no wallet address")
        log.info("roqqu.wallet.generated", network=network, address=address)
        return {"address": address, "network": network}

    def get_addresses(self, *, network: str) -> list[dict[str, Any]]:
        """Every address on a network (POST /wallets/get-addresses)."""
        with traced("roqqu.get_addresses", network=network):
            return list(self._call("POST", "/wallets/get-addresses", form={"network": network}) or [])

    def wallet_received(self, *, network: str, address: str) -> dict[str, Any]:
        """Authoritative amount received on one of our addresses (`total_received`),
        never a client claim or the webhook body alone."""
        for wallet in self.get_addresses(network=network):
            if str(wallet.get("address", "")).lower() == address.lower():
                received = Decimal(str(wallet.get("total_received") or 0))
                result = {"status": "PAID" if received > 0 else "PENDING", "amount_token": str(received)}
                log.info("roqqu.wallet.checked", address=address, status=result["status"])
                return result
        raise RoqquError(f"address {address} is not one of this account's {network} addresses")

    def delete_wallet(self, *, network: str, address: str) -> None:
        """DELETE /wallets/delete."""
        self._call("DELETE", "/wallets/delete", form={"network": network, "address": address})

    def what_network(self, *, address: str) -> list[str]:
        """Networks an address belongs to (POST /wallets/what-network). Empty = not a real address."""
        with traced("roqqu.what_network"):
            try:
                return [str(n) for n in (self._call("POST", "/wallets/what-network", form={"address": address}) or [])]
            except RoqquError as exc:
                if "cannot find" in str(exc).lower():
                    return []
                raise

    def send(self, *, token: str, network: str, to: str, amount: Decimal) -> dict[str, Any]:
        """Send crypto from the merchant balance (POST /wallets/send). Fees come out
        of the token sent. On-chain confirmation arrives later as `token_sent`."""
        with traced("roqqu.send", token=token, network=network, amount=str(amount)):
            data = self._call(
                "POST",
                "/wallets/send",
                form={"amount": str(amount), "network": network, "to": to, "token": token},
            )
        log.info("roqqu.token.sent", token=token, network=network, to=to)
        return {"status": "queued", "refid": str((data or {}).get("refid", "")), "token": token,
                "network": network, "amount": str(amount), "to": to}

    # --- Payment links ------------------------------------------------------

    def create_payment_link(
        self,
        *,
        amount_ngn: Decimal,
        reference: str,
        customer: dict[str, str],
        success_url: str,
        cancel_url: str,
        metadata: dict[str, Any] | None = None,
        options: tuple[str, ...] = tuple(PAY_OPTIONS),
    ) -> dict[str, Any]:
        """POST /payment-links: a hosted Roqqu checkout priced in NGN with
        pre-generated addresses for each pay option."""
        wallets = [{"network": PAY_OPTIONS[o][0], "token": PAY_OPTIONS[o][1].upper()} for o in options]
        with traced("roqqu.payment_link", reference=reference):
            data = self._call(
                "POST",
                "/payment-links",
                form={
                    "amount": str(amount_ngn),
                    "amount_currency": "ngn",
                    "customer_details": customer,
                    "payment_reference": reference,
                    "success_url": success_url,
                    "cancel_url": cancel_url,
                    "metadata": metadata or {},
                    "wallets": wallets,
                },
            )
        return dict(data or {})

    # --- Balances & transactions ---------------------------------------------

    def balances(self, *, token: str = "") -> dict[str, Any]:
        """POST /balances: merchant balance per token."""
        data = self._call("POST", "/balances", form={"token": token} if token else {})
        return dict((data or {}).get("balance") or {})

    def network_fee(self, *, network: str) -> Decimal:
        """POST /transaction/network-fee: estimated fee for one send."""
        data = self._call("POST", "/transaction/network-fee", form={"network": network}) or {}
        return Decimal(str(data.get("fee", 0)))

    def send_record(self, *, refid: str) -> dict[str, Any]:
        """GET /transaction/refId/:refid: the queued send and its status."""
        return dict(self._call("GET", f"/transaction/refId/{refid}") or {})


# --- Public market data (no key) ----------------------------------------------

_TTL_S = 60.0
_cache: dict[str, dict[str, Any]] = {}


def _public(base_url: str, path: str, transport: httpx.BaseTransport | None) -> Any:
    """GET a public RAS endpoint, cached for a minute so a busy dashboard stays polite."""
    now = time.monotonic()
    hit = _cache.get(path)
    if hit and now - hit["at"] < _TTL_S:
        if hit["error"]:
            raise RoqquError(hit["error"])  # don't hammer a down API
        return hit["data"]
    try:
        with httpx.Client(base_url=base_url.rstrip("/"), timeout=6.0, transport=transport) as http:
            resp = http.get(path)
        body = resp.json()
        if resp.status_code >= 400 or body.get("status") != "success":
            raise RoqquError(body.get("message") or f"HTTP {resp.status_code}")
    except (httpx.HTTPError, ValueError, RoqquError) as exc:
        message = str(exc) if isinstance(exc, RoqquError) else type(exc).__name__
        _cache[path] = {"at": now, "data": None, "error": f"Roqqu {path} unavailable: {message}"}
        raise RoqquError(_cache[path]["error"]) from exc
    _cache[path] = {"at": now, "data": body.get("data"), "error": ""}
    return body.get("data")


def public_prices(base_url: str, *, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """GET /prices: USD price and 24h change of every token."""
    return dict(_public(base_url, "/prices", transport) or {})


def ngn_per_usd(settings: Settings, *, transport: httpx.BaseTransport | None = None) -> Decimal:
    """Live NGN per USD from GET /rates; the configured fallback when RAS is unreachable."""
    try:
        for row in _public(settings.roqqu_base_url, "/rates", transport) or []:
            if str(row.get("symbol")).lower() == "ngn" and row.get("rate"):
                return Decimal(str(row["rate"]))
    except RoqquError:
        pass
    return Decimal(settings.roqqu_ngn_per_usd)


def token_price_usd(settings: Settings, token: str) -> Decimal:
    if token.lower() in ("usdt", "usdc"):
        return Decimal(1)
    row = public_prices(settings.roqqu_base_url).get(token.lower()) or {}
    if not row.get("price"):
        raise RoqquError(f"no Roqqu price for {token}")
    return Decimal(str(row["price"]))


def usd_to_ngn(usd: Decimal | str, settings: Settings) -> Decimal:
    return (Decimal(str(usd)) * ngn_per_usd(settings)).quantize(Decimal("0.01"))


def ngn_to_token(ngn: Decimal | str, price_usd: Decimal, settings: Settings) -> Decimal:
    """How much of a token covers an NGN amount (rounded up to 8 dp)."""
    usd = Decimal(str(ngn)) / ngn_per_usd(settings)
    return (usd / price_usd).quantize(Decimal("0.00000001"), rounding=ROUND_UP)
