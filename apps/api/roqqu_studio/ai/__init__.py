"""Rooky, the Roqqu Studio assistant (#15, D16, D18)."""

from .composer import (
    ComposeError,
    ComposeOutcome,
    ComposeRefused,
    ComposeUnavailable,
    compose_flow,
    refine_flow,
)
from .explain import Explanation, Source, explain
from .rooky import classify_intent
from .providers import AIProvider, select_provider
from .schema import RookyAnswer, RookyFlow, RookyIntent

__all__ = [
    "AIProvider",
    "ComposeError",
    "ComposeOutcome",
    "ComposeRefused",
    "ComposeUnavailable",
    "Explanation",
    "RookyAnswer",
    "RookyFlow",
    "RookyIntent",
    "Source",
    "classify_intent",
    "compose_flow",
    "refine_flow",
    "explain",
    "select_provider",
]
