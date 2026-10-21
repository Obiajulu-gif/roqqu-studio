"""Roqqu API client, built from https://developers.roqqu.com (API v1).

Every endpoint lives under `https://api.roqqu.com/prod/v1`. POST calls carry
`Authorization: Bearer <secret key>` (dashboard -> Security). Responses share
one envelope: `{"status": "success"|"fail", "message": ..., "data": ...}`.

Roqqu has no sandbox, so the settings guard refuses every live call unless
ALLOW_PRODUCTION_EXECUTION=true. The secret key is registered with the log
redactor so it can never surface in a log or a shared trace.

Docs map:
  Wallet      POST /user/generate-wallet, /user/wallets, /user/delete-wallet,
              /user/send-{token}; deposits arrive by webhook (Receive Token)
  Blockchain  GET  /blockchain/address   (1 call / 100 s, else a 10 h IP ban)
  Market      GET  /price
  Fiat        POST /user/account-resolve, /user/bvn-verify, /user/nin-verify
  Bills       POST /user/recharge-airtime, /user/pay-electric
"""

from __future__ import annotations

import threading
import time
from decimal import Decimal
from typing import Any

import httpx

from ...config import Settings
from ...observability import get_logger, register_secret, traced

log = get_logger("roqqu")

DOCS = "https://developers.roqqu.com/reference"
WALLET_TOKENS = ("btc", "eth", "trx")  # Generate/Get/Delete Wallet support only these

_ADDRESS_LOOKUP_GAP_S = 100.0
_address_lock = threading.Lock()
_last_address_lookup = 0.0


class RoqquError(RuntimeError):
    """A Roqqu request failed or returned status != success."""


class RoqquClient:
    """Thin Roqqu client. Use as a context manager."""

    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None) -> None:
        if not settings.roqqu_secret_key:
            raise RoqquError("Roqqu keys not configured: set ROQQU_SECRET_KEY")
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
            headers={"Authorization": f"Bearer {settings.roqqu_secret_key}"},
        )

    def __enter__(self) -> "RoqquClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self._http.close()

    def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        """Send one request and return the envelope's `data`."""
        try:
            resp = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:  # DNS, timeout, refused
            raise RoqquError(f"Roqqu unreachable: {type(exc).__name__}") from exc
        try:
            body = resp.json()
        except ValueError as exc:
            raise RoqquError(f"Non-JSON response from Roqqu (HTTP {resp.status_code})") from exc
        # The docs show some 400s with status "success", so the HTTP code wins.
        if resp.status_code >= 400 or body.get("status") != "success":
            raise RoqquError(body.get("message") or f"HTTP {resp.status_code}")
        return body.get("data")

    # --- Wallet ---------------------------------------------------------

    def generate_wallet(self, *, token: str) -> dict[str, Any]:
        """New deposit address for btc, eth or trx (POST /user/generate-wallet)."""
        token = _wallet_token(token)
        with traced("roqqu.generate_wallet", token=token):
            data = self._call("POST", "/user/generate-wallet", json={"token": token})
        address = (data or {}).get("address")
        if not address:
            raise RoqquError("Roqqu returned no wallet address")
        log.info("roqqu.wallet.generated", token=token, address=address)
        return {
            "address": address,
            "token": data.get("type", token),
            "total_received": str(data.get("total_received", 0)),
            "created_at": data.get("created_at", ""),
        }

    def get_wallets(self, *, token: str) -> list[dict[str, Any]]:
        """Every wallet on the account for a token (POST /user/wallets).

        The docs warn this has no limit, so call it once per check, not in a loop."""
        token = _wallet_token(token)
        with traced("roqqu.get_wallets", token=token):
            return list(self._call("POST", "/user/wallets", json={"token": token}) or [])

    def wallet_received(self, *, token: str, address: str) -> dict[str, Any]:
        """Authoritative amount received on one of our addresses.

        Read from Get Wallets (`total_received`, `total_received_usdt`), never
        from a client claim or the webhook body alone."""
        for wallet in self.get_wallets(token=token):
            if wallet.get("address") == address:
                received = Decimal(str(wallet.get("total_received") or 0))
                usd = Decimal(str(wallet.get("total_received_usdt") or 0))
                result = {
                    "status": "PAID" if received > 0 else "PENDING",
                    "amount_token": str(received),
                    "amount_usd": str(usd),
                }
                log.info("roqqu.wallet.checked", address=address, status=result["status"])
                return result
        raise RoqquError(f"address {address} is not one of this account's {token} wallets")

    def delete_wallet(self, *, token: str, address: str) -> None:
        """POST /user/delete-wallet. Deposits to it are still credited (per docs)."""
        self._call("POST", "/user/delete-wallet", json={"token": _wallet_token(token), "address": address})

    def send_token(
        self, *, token: str, amount: Decimal, wallet: str, memo: str = "", tag: str = ""
    ) -> dict[str, Any]:
        """Send crypto to an address (POST /user/send-{token}).

        `memo` is used by BNB, EOS, HIVE and STEEM only; `tag` by Ripple."""
        token = token.strip().lower()
        payload: dict[str, Any] = {"amount": float(amount), "wallet": wallet}
        if memo:
            payload["memo"] = memo
        if tag:
            payload["tag"] = tag
        with traced("roqqu.send_token", token=token, amount=str(amount)):
            self._call("POST", f"/user/send-{token}", json=payload)
        log.info("roqqu.token.sent", token=token, wallet=wallet)
        return {"status": "sent", "token": token, "amount": str(amount), "wallet": wallet}

    # --- Blockchain utilities ---------------------------------------------

    def blockchain_address(self, *, symbol: str, address: str) -> dict[str, Any]:
        """Live chain data for an address (GET /blockchain/address).

        Roqqu bans the caller's IP for 10 hours above 1 call per 100 s, so this
        process refuses a second call inside that window instead of risking it."""
        global _last_address_lookup
        with _address_lock:
            wait = _ADDRESS_LOOKUP_GAP_S - (time.monotonic() - _last_address_lookup)
            if _last_address_lookup and wait > 0:
                raise RoqquError(f"address lookup is rate limited; retry in {int(wait) + 1}s")
            _last_address_lookup = time.monotonic()
        with traced("roqqu.blockchain_address", symbol=symbol):
            return dict(
                self._call("GET", "/blockchain/address", params={"symbol": symbol, "addr": address})
                or {}
            )

    # --- Market -----------------------------------------------------------

    def token_price(self, *, symbol: str) -> Decimal:
        """Current USD price of a token (GET /price)."""
        with traced("roqqu.token_price", symbol=symbol):
            return Decimal(str(self._call("GET", "/price", params={"symbol": symbol.lower()})))

    # --- Fiat -------------------------------------------------------------

    def account_resolve(self, *, account_number: str, bank: str) -> str:
        """Account holder name for a Nigerian bank account (POST /user/account-resolve).

        `bank` is the bank's name as listed by GET /banks."""
        with traced("roqqu.account_resolve"):
            name = self._call(
                "POST",
                "/user/account-resolve",
                json={"account_number": account_number, "bank": bank},
            )
        if not name:
            raise RoqquError("Roqqu could not resolve that account")
        return str(name)

    def bvn_verify(self, *, bvn: str) -> dict[str, Any]:
        """POST /user/bvn-verify. Roqqu charges NGN 20 per successful call."""
        with traced("roqqu.bvn_verify"):
            return dict(self._call("POST", "/user/bvn-verify", json={"bvn": bvn}) or {})

    def nin_verify(self, *, nin: str) -> dict[str, Any]:
        """POST /user/nin-verify. Roqqu charges NGN 100 per successful call."""
        with traced("roqqu.nin_verify"):
            return dict(self._call("POST", "/user/nin-verify", json={"nin": nin}) or {})

    # --- Bills ------------------------------------------------------------

    def recharge_airtime(self, *, phone_number: str, amount: Decimal) -> None:
        """POST /user/recharge-airtime."""
        self._call(
            "POST",
            "/user/recharge-airtime",
            json={"phone_number": phone_number, "amount": float(amount)},
        )

    def pay_electric(
        self, *, provider: str, meter_type: str, meter_number: str, amount: Decimal, phone_number: str
    ) -> dict[str, Any]:
        """POST /user/pay-electric. Roqqu keeps NGN 100 of `amount` as a fee."""
        return dict(
            self._call(
                "POST",
                "/user/pay-electric",
                json={
                    "provider": provider,
                    "meter_type": meter_type,
                    "meter_number": meter_number,
                    "amount": float(amount),
                    "phone_number": phone_number,
                },
            )
            or {}
        )


def usd_to_ngn(usd: Decimal | str, settings: Settings) -> Decimal:
    return (Decimal(str(usd)) * Decimal(settings.roqqu_ngn_per_usd)).quantize(Decimal("0.01"))


def ngn_to_token(ngn: Decimal | str, price_usd: Decimal, settings: Settings) -> Decimal:
    """How much of a token covers an NGN amount (rounded up to 8 dp)."""
    usd = Decimal(str(ngn)) / Decimal(settings.roqqu_ngn_per_usd)
    return (usd / price_usd).quantize(Decimal("0.00000001"), rounding="ROUND_UP")


def _wallet_token(token: str) -> str:
    token = (token or "").strip().lower()
    if token not in WALLET_TOKENS:
        raise RoqquError(f"Roqqu wallets support {', '.join(WALLET_TOKENS)} only, not {token!r}")
    return token
