"""Runtime configuration and the sandbox-only guard (#7).

Secrets come from the environment (or a `.env` file), never from code. Production
execution is refused unless explicitly enabled, which we never do in the
challenge build (security standard).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Search the current dir and up to two parents so it works whether run from
    # the repo root or from apps/api.
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Roqqu API (https://developers.roqqu.com): one secret key, sent as
    # `Authorization: Bearer RQ-SEC-...` (dashboard -> Security).
    roqqu_secret_key: str = ""
    # The `secret` you typed when registering the webhook URL on the Roqqu
    # dashboard; Roqqu echoes it in every deposit webhook body.
    roqqu_webhook_secret: str = ""
    roqqu_base_url: str = "https://api.roqqu.com/prod/v1"
    # Token buyers pay in. Generate Wallet supports btc, eth and trx only.
    roqqu_pay_token: str = "trx"
    # ponytail: Roqqu prices are USD and it has no NGN rate endpoint, so the
    # NGN->USD bridge is a manual rate; swap for a live FX feed if it matters.
    roqqu_ngn_per_usd: str = "1500"

    allow_production_execution: bool = False
    studio_env: str = "development"

    @property
    def is_sandbox(self) -> bool:
        # Roqqu has no sandbox: every call hits production (real crypto).
        return "sandbox" in self.roqqu_base_url

    def assert_sandbox(self) -> None:
        if not self.is_sandbox and not self.allow_production_execution:
            raise RuntimeError(
                "Roqqu has no sandbox: live calls move real crypto. Set "
                "ALLOW_PRODUCTION_EXECUTION=true only when you intend that."
            )

    def assert_roqqu_credentials(self) -> None:
        if not self.roqqu_secret_key:
            raise RuntimeError("Missing Roqqu credentials: ROQQU_SECRET_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
