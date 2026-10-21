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

    roqqu_api_key: str = ""
    roqqu_secret_key: str = ""
    roqqu_contract_code: str = ""
    # PLACEHOLDER: set ROQQU_BASE_URL from Roqqu's API docs (none public yet).
    roqqu_base_url: str = "https://sandbox.api.roqqu.com"
    # Disbursement source wallet account number (#9). Roqqu won't let us list
    # wallets on this sandbox, so the source account is supplied out of band.
    roqqu_wallet_account: str = ""

    allow_production_execution: bool = False
    studio_env: str = "development"

    @property
    def is_sandbox(self) -> bool:
        return "sandbox" in self.roqqu_base_url

    def assert_sandbox(self) -> None:
        if not self.is_sandbox and not self.allow_production_execution:
            raise RuntimeError(
                "Refusing a non-sandbox Roqqu base URL. Set ALLOW_PRODUCTION_EXECUTION=true "
                "only if you truly intend to hit production (never in the challenge build)."
            )

    def assert_roqqu_credentials(self) -> None:
        missing = [
            name
            for name, value in {
                "ROQQU_API_KEY": self.roqqu_api_key,
                "ROQQU_SECRET_KEY": self.roqqu_secret_key,
                "ROQQU_CONTRACT_CODE": self.roqqu_contract_code,
            }.items()
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing Roqqu sandbox credentials: {', '.join(missing)}")


@lru_cache
def get_settings() -> Settings:
    return Settings()
