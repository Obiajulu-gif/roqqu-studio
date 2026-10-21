"""Product templates: ready-made, analyzer-clean payment products (#51, D17).

A template is a curated Workflow builder plus the storefront metadata the
picker shows ("What do you want to set up?"). Templates are the D17 bridge:
the seller picks a product in plain language; what she actually gets is our
typed IR with every safety node already in place.

Registry pattern mirrors the provider catalog (D13): adding a template is one
module + one registry entry, never an engine change.
"""

from __future__ import annotations

from typing import Callable

from pydantic import BaseModel

from ..ir.models import Workflow
from .ajo import ajo
from .bills import bills
from .invoice import invoice
from .more import kyc, price_alerts, sell_data, withdrawals
from .payroll import payroll
from .sell_online import sell_online


class TemplateInfo(BaseModel):
    """What the picker renders. Kept flat and frontend-friendly (#55 contract)."""

    id: str
    title: str
    persona: str
    description: str


class TemplateDef(BaseModel):
    info: TemplateInfo
    builder: Callable[[], Workflow]


_TEMPLATES: dict[str, TemplateDef] = {
    "sell-online": TemplateDef(
        info=TemplateInfo(
            id="sell-online",
            title="Sell online with verified payments",
            persona="Small business selling on Instagram / WhatsApp",
            description=(
                "A payment link plus an orders dashboard. An order is only marked "
                "paid after Roqqu confirms the money server-side, so fake credit "
                "alerts and doctored transfer screenshots never release goods."
            ),
        ),
        builder=sell_online,
    ),
    "invoice": TemplateDef(
        info=TemplateInfo(
            id="invoice",
            title="Invoice a client, get paid",
            persona="Freelancer / B2B billing",
            description=(
                "Create an invoice, share the link. The buyer pays in crypto to a "
                "fresh Roqqu address, and the invoice is only marked paid once Roqqu "
                "shows the deposit landed."
            ),
        ),
        builder=invoice,
    ),
    "ajo": TemplateDef(
        info=TemplateInfo(
            id="ajo",
            title="Collect contributions (ajo / savings group)",
            persona="Ajo / esusu / cooperative running a savings pool",
            description=(
                "Members save into a shared pool through their own dedicated "
                "accounts. Every contribution is only credited after Roqqu "
                "confirms it, and the cycle payout only leaves after the pool is "
                "checked and the receiver's account is validated by name."
            ),
        ),
        builder=ajo,
    ),
    "payroll": TemplateDef(
        info=TemplateInfo(
            id="payroll",
            title="Pay staff salaries (payroll)",
            persona="Small business paying staff every month",
            description=(
                "Employee list in, salaries out. Every account number is validated "
                "with Name Enquiry before any money moves, and the whole batch is "
                "reconciled after, so a typo never sends a salary to a stranger."
            ),
        ),
        builder=payroll,
    ),
    "pay-bills": TemplateDef(
        info=TemplateInfo(
            id="pay-bills",
            title="Pay bills (electricity & airtime)",
            persona="Vendor or app selling airtime and power units",
            description=(
                "Sell electricity units and airtime through Roqqu. The meter is "
                "checked by name before money moves, each request is paid once, "
                "and your Roqqu balance is checked first."
            ),
        ),
        builder=bills,
    ),
    "sell-data": TemplateDef(
        info=TemplateInfo(
            id="sell-data",
            title="Sell data bundles",
            persona="Vendor or app reselling mobile data",
            description=(
                "Live plans from Roqqu, each order paid once, and your balance checked "
                "before the bundle is bought."
            ),
        ),
        builder=sell_data,
    ),
    "withdrawals": TemplateDef(
        info=TemplateInfo(
            id="withdrawals",
            title="Customer crypto withdrawals",
            persona="App or exchange paying customers out in crypto",
            description=(
                "Each request is paid once, the destination address is checked on Roqqu "
                "and your balance must cover it before Send Token runs."
            ),
        ),
        builder=withdrawals,
    ),
    "kyc": TemplateDef(
        info=TemplateInfo(
            id="kyc",
            title="Verify customers (KYC)",
            persona="Any business that must know who it pays",
            description=(
                "BVN and NIN checks plus bank account resolve, all through Roqqu, before a "
                "customer can transact."
            ),
        ),
        builder=kyc,
    ),
    "price-alerts": TemplateDef(
        info=TemplateInfo(
            id="price-alerts",
            title="Crypto price alerts",
            persona="Merchants and traders watching coin prices",
            description=(
                "Roqqu prices checked on a schedule, with a WhatsApp alert when a coin "
                "crosses your level."
            ),
        ),
        builder=price_alerts,
    ),
}


def list_templates() -> list[TemplateInfo]:
    return [t.info for t in _TEMPLATES.values()]


def get_template(template_id: str) -> TemplateDef | None:
    return _TEMPLATES.get(template_id)


def build_template(template_id: str) -> Workflow:
    """Fresh Workflow instance for a template. Raises KeyError if unknown."""
    template = _TEMPLATES.get(template_id)
    if template is None:
        raise KeyError(template_id)
    return template.builder()


__all__ = [
    "TemplateDef",
    "TemplateInfo",
    "build_template",
    "get_template",
    "list_templates",
]
