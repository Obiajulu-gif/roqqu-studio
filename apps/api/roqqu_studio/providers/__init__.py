from .base import Catalog, NodeTypeDef, PortSpec
from .core import CORE_NODE_TYPES
from .roqqu import ROQQU_NODE_TYPES


def default_catalog() -> Catalog:
    """Core (provider-neutral) types + the Roqqu pack.

    To support another provider later, register its pack here - the engine,
    analyzer and IR need no changes (D13).
    """
    return Catalog(CORE_NODE_TYPES).register_pack(ROQQU_NODE_TYPES)


__all__ = [
    "CORE_NODE_TYPES",
    "ROQQU_NODE_TYPES",
    "Catalog",
    "NodeTypeDef",
    "PortSpec",
    "default_catalog",
]
