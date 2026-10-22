"""Keep every test offline: public RAS market data (/rates, /prices) answers
'unreachable' unless a test installs its own transport or cache."""

from __future__ import annotations

import time

import pytest

from roqqu_studio.integrations.roqqu import client as client_mod


@pytest.fixture(autouse=True)
def _offline_market_data(monkeypatch):
    now = time.monotonic()
    monkeypatch.setattr(
        client_mod,
        "_cache",
        {
            "/rates": {"at": now, "data": None, "error": "offline in tests"},
            "/prices": {"at": now, "data": None, "error": "offline in tests"},
        },
    )
