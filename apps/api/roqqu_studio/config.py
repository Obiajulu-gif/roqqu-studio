"""Runtime configuration and the sandbox-only guard (#7).

Secrets come from the environment (or a `.env` file), never from code. Production
execution is refused unless explicitly enabled, which we never do in the
challenge build (security standard).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import model_validator
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

    # Roqqu API Service (https://roqqu-api-services.gitbook.io/ras). Keys come
    # from the RAS console (Settings -> API Keys and Webhooks): a test key sent as
    # `x-staging-api-key`, a live key sent as `x-api-key`.
    ras_test_key: str = ""
    ras_live_key: str = ""
    # practice | test | live. Blank: test when a test key is set, else live when a
    # live key is set, else practice (everything simulated).
    ras_mode: str = ""
    # The key real calls use, resolved from the mode (per-workflow keys override it).
    roqqu_secret_key: str = ""
    roqqu_base_url: str = "https://service.roqqu.com/v1"
    # What buyers pay with: usdt_trc20 | usdt_bep20 | btc (RAS payment-link options).
    roqqu_pay_token: str = "usdt_trc20"
    # Fallback NGN per USD, used only when RAS GET /rates is unreachable.
    roqqu_ngn_per_usd: str = "1360"

    allow_production_execution: bool = False
    studio_env: str = "development"

    @model_validator(mode="after")
    def _resolve_mode(self) -> "Settings":
        mode = self.ras_mode.strip().lower()
        if mode not in ("practice", "test", "live"):
            mode = "test" if self.ras_test_key else "live" if self.ras_live_key else "practice"
        self.ras_mode = mode
        if not self.roqqu_secret_key:
            self.roqqu_secret_key = {"test": self.ras_test_key, "live": self.ras_live_key}.get(mode, "")
        return self

    @property
    def is_sandbox(self) -> bool:
        """True in RAS test mode: test keys never move real crypto."""
        return self.ras_mode != "live"

    @property
    def ras_key_header(self) -> str:
        return "x-api-key" if self.ras_mode == "live" else "x-staging-api-key"

    def assert_sandbox(self) -> None:
        if not self.is_sandbox and not self.allow_production_execution:
            raise RuntimeError(
                "Live mode moves real crypto. Set ALLOW_PRODUCTION_EXECUTION=true only "
                "when you intend that, or use a RAS test key (RAS_TEST_KEY)."
            )

    def assert_roqqu_credentials(self) -> None:
        if not self.roqqu_secret_key:
            raise RuntimeError("Missing Roqqu credentials: RAS_TEST_KEY or RAS_LIVE_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()
