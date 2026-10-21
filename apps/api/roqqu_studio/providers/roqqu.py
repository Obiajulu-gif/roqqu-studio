"""The Roqqu provider pack (D13).

Every Roqqu endpoint Studio understands is declared here as a `NodeTypeDef`,
mapping the concrete API onto the neutral capability vocabulary. This is the
only file that must be re-authored to add another payment provider.

`when_to_use` lines are quoted/condensed from the official Roqqu API Feature
Cheat Sheet (#25), so Moni reasons from Roqqu's documented features rather
than from training memory.

References: https://roqqu.com

Traceability: #3 (P1.1 - node catalog), #25 (cheat-sheet grounding); decision D13.
"""

from __future__ import annotations

from ..ir.types import CapabilityTag as T
from ..ir.types import DomainType as D
from ..ir.types import NodeCategory as C
from .base import NodeTypeDef, PortSpec

DOCS_COLLECTIONS = "https://roqqu.com"
DOCS_ONE_TIME = "https://roqqu.com"
DOCS_API = "https://roqqu.com"

ROQQU_NODE_TYPES: list[NodeTypeDef] = [
    NodeTypeDef(
        type="roqqu.initialize_transaction",
        category=C.ROQQU,
        title="Initialize Transaction",
        description="Create a transaction and get a checkout URL / payment reference.",
        when_to_use="Standard e-commerce checkout, one-off ticket sales, or simple digital "
        "product sales: a secure multi-channel widget (card, USSD, bank transfer).",
        doc_url=DOCS_ONE_TIME,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[
            PortSpec(name="amount", type=D.MONEY),
            PortSpec(name="customer", type=D.CUSTOMER, required=False),
        ],
        outputs=[
            PortSpec(name="payment_reference", type=D.PAYMENT_REFERENCE),
            PortSpec(name="checkout_url", type=D.CHECKOUT_URL),
        ],
    ),
    NodeTypeDef(
        type="roqqu.verify_transaction",
        category=C.ROQQU,
        title="Verify Transaction",
        description="Server-side query of authoritative payment status and amount paid.",
        when_to_use="Confirm a collection's real status and amount server-side after the "
        "webhook. Never trust the client callback; verify once rather than heavily polling.",
        doc_url=DOCS_API,
        # This IS the authoritative check - the antidote to trusting a callback.
        default_tags=[T.EXTERNAL_CALL, T.AUTHORITATIVE_VERIFICATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="payment_reference", type=D.PAYMENT_REFERENCE)],
        outputs=[
            PortSpec(name="status", type=D.TRANSACTION_STATUS),
            PortSpec(name="amount_paid", type=D.MONEY),
        ],
    ),
    NodeTypeDef(
        type="roqqu.initiate_transfer",
        category=C.ROQQU,
        title="Initiate Transfer (Disbursement)",
        description="Move money out to a beneficiary - e.g. the provider payout.",
        when_to_use="Real-time single payout from your Roqqu wallet to any Nigerian bank "
        "account or wallet: user withdrawals, P2P, or an individual vendor payout.",
        doc_url=DOCS_API,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.BENEFICIARY_TRANSFER, T.SECRET_BOUNDARY],
        inputs=[
            PortSpec(name="account_number", type=D.ACCOUNT_NUMBER),
            PortSpec(name="amount", type=D.MONEY),
        ],
        outputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
    ),
    NodeTypeDef(
        type="roqqu.bulk_transfer",
        category=C.ROQQU,
        title="Bulk Transfer",
        description="Disburse to up to 5,000 beneficiaries in one batch (payroll, vendors).",
        when_to_use="One batch of up to 5,000 payouts: automated payroll, affiliate rewards, "
        "or bulk multi-vendor settlements.",
        doc_url=DOCS_API,
        # Carries BENEFICIARY_TRANSFER so MON011 demands validation upstream (#54, #24).
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.BENEFICIARY_TRANSFER, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="amount", type=D.MONEY)],
        outputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
    ),
    NodeTypeDef(
        type="roqqu.query_transfer_status",
        category=C.ROQQU,
        title="Query Transfer Status",
        description="Authoritative status of a disbursement - required before retrying one.",
        when_to_use="Confirm a disbursement's real status, and always before retrying a "
        "transfer after an ambiguous timeout (the original may have succeeded).",
        doc_url=DOCS_API,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
        outputs=[PortSpec(name="status", type=D.TRANSACTION_STATUS)],
    ),
    NodeTypeDef(
        type="roqqu.transaction_split",
        category=C.ROQQU,
        title="Transaction Split",
        description="Split settlement across subaccounts AT payment time (immediate).",
        when_to_use="Multi-vendor marketplaces that split one incoming payment across "
        "sub-accounts at payment time (e.g. take a platform fee before paying the vendor). "
        "Settles immediately, so it is the wrong tool when payout must wait for fulfilment.",
        doc_url=DOCS_API,
        # The primitive MON009 warns against for payout-after-fulfilment (D10).
        default_tags=[T.EXTERNAL_CALL, T.IMMEDIATE_SPLIT, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="amount", type=D.MONEY)],
    ),
    NodeTypeDef(
        type="roqqu.validate_bank_account",
        category=C.ROQQU,
        title="Validate Bank Account (Name Enquiry)",
        description="KYC Match - resolve and confirm a beneficiary account name before paying it.",
        when_to_use="Onboarding/KYC and, critically, validating a payout account name (Name "
        "Enquiry) before a transfer, so money never lands in a wrong account. Also BVN/NIN.",
        doc_url=DOCS_API,
        default_tags=[T.EXTERNAL_CALL, T.BENEFICIARY_VALIDATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="account_number", type=D.ACCOUNT_NUMBER)],
        outputs=[PortSpec(name="account_name", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.create_invoice",
        category=C.ROQQU,
        title="Create Invoice",
        description="A trackable invoice with an explicit amount the buyer pays online.",
        when_to_use="Trackable, customised payment invoices with explicit amounts and "
        "expiry: ideal for B2B services, recurring billing, marketplace orders, or "
        "post-delivery merchant payments. The buyer pays the invoice link; settlement "
        "lands in the merchant's Roqqu (Moniepoint) account.",
        doc_url=DOCS_COLLECTIONS,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[
            PortSpec(name="amount", type=D.MONEY),
            PortSpec(name="customer", type=D.CUSTOMER, required=False),
        ],
        outputs=[
            PortSpec(name="payment_reference", type=D.PAYMENT_REFERENCE),
            PortSpec(name="checkout_url", type=D.CHECKOUT_URL),
        ],
    ),
    NodeTypeDef(
        type="roqqu.create_reserved_account",
        category=C.ROQQU,
        title="Create Reserved Account",
        description="Dedicated virtual account for a customer (wallet funding, invoices).",
        when_to_use="Fintech wallets, savings apps, or any platform where users fund an in-app "
        "balance via a permanent dedicated bank account (bank transfer).",
        doc_url=DOCS_COLLECTIONS,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="customer", type=D.CUSTOMER)],
        outputs=[PortSpec(name="account_number", type=D.ACCOUNT_NUMBER)],
    ),
    NodeTypeDef(
        type="roqqu.initiate_refund",
        category=C.ROQQU,
        title="Initiate Refund",
        description="Refund a previously verified transaction.",
        when_to_use="Automate order cancellations, e-commerce returns, or dispute resolution: "
        "an instant full or partial rollback to the customer's original payment source.",
        doc_url=DOCS_API,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="transaction_reference", type=D.TRANSACTION_REFERENCE)],
    ),
]


# Request templates grounded in Roqqu's OpenAPI spec (#176, #25). Each is the
# editable request body a dev sees on the block - example values come straight
# from the spec at https://roqqu.com
# The body rides into node.config (execution + codegen already merge it); the
# analyzer still verifies the graph, so editing the request never bypasses the
# 200-is-not-correct guardrail.
_REQUEST_TEMPLATES: dict[str, dict] = {
    "roqqu.initialize_transaction": {
        "method": "POST",
        "path": "/api/v1/merchant/transactions/init-transaction",
        "body": {
            "amount": 100.00,
            "customerName": "John Doe",
            "customerEmail": "customer@example.com",
            "paymentReference": "<unique-reference>",
            "paymentDescription": "Order payment",
            "currencyCode": "NGN",
            "contractCode": "<your-contract-code>",
            "redirectUrl": "https://your-app.com/payment/return",
            "paymentMethods": ["CARD", "ACCOUNT_TRANSFER"],
        },
    },
    "roqqu.verify_transaction": {
        "method": "GET",
        "path": "/api/v2/merchant/transactions/query",
        "body": {"paymentReference": "<the-payment-reference>"},
    },
    "roqqu.create_reserved_account": {
        "method": "POST",
        "path": "/api/v2/bank-transfer/reserved-accounts",
        "body": {
            "accountReference": "<unique-account-reference>",
            "accountName": "Customer Wallet",
            "currencyCode": "NGN",
            "contractCode": "<your-contract-code>",
            "customerEmail": "customer@example.com",
            "customerName": "John Doe",
            "bvn": "<member-bvn-or-use-nin>",
            "nin": "<member-nin-or-use-bvn>",
            "getAllAvailableBanks": True,
        },
    },
    "roqqu.create_invoice": {
        "method": "POST",
        "path": "/api/v1/invoice/create",
        "body": {
            "amount": 5000.00,
            "currencyCode": "NGN",
            "invoiceReference": "<unique-invoice-reference>",
            "customerName": "John Snow",
            "customerEmail": "customer@example.com",
            "contractCode": "<your-contract-code>",
            "description": "Invoice for services",
            "expiryDate": "2026-12-31 23:59:59",
            "redirectUrl": "https://your-app.com/invoice/return",
        },
    },
    "roqqu.initiate_transfer": {
        "method": "POST",
        "path": "/api/v2/disbursements/single",
        "body": {
            "amount": 200.00,
            "reference": "<unique-reference>",
            "narration": "Payout",
            "destinationBankCode": "50515",
            "destinationAccountNumber": "2085886393",
            "destinationAccountName": "Ciroma Chukwuka Adekunle",
            "currency": "NGN",
            "sourceAccountNumber": "<your-wallet-account-number>",
        },
    },
    "roqqu.bulk_transfer": {
        "method": "POST",
        "path": "/api/v2/disbursements/batch",
        "body": {
            "title": "Payroll July",
            "batchReference": "<unique-batch-reference>",
            "narration": "Salary payout",
            "sourceAccountNumber": "<your-wallet-account-number>",
            "onValidationFailure": "CONTINUE",
            "notificationInterval": 10,
            "transactionList": [
                {
                    "amount": 1300.00,
                    "reference": "<unique-item-reference>",
                    "narration": "Salary",
                    "destinationBankCode": "50515",
                    "destinationAccountNumber": "2085886393",
                    "currency": "NGN",
                }
            ],
        },
    },
    "roqqu.query_transfer_status": {
        "method": "GET",
        "path": "/api/v2/disbursements/single/summary",
        "body": {"reference": "<the-transfer-reference>"},
    },
    "roqqu.validate_bank_account": {
        "method": "GET",
        "path": "/api/v2/disbursements/account/validate",
        "body": {"accountNumber": "2085886393", "bankCode": "50515"},
    },
    "roqqu.transaction_split": {
        "method": "POST",
        "path": "/api/v1/merchant/transactions/init-transaction",
        "body": {
            "incomeSplitConfig": [
                {
                    "subAccountCode": "MFY_SUB_762212281785",
                    "feePercentage": 10.50,
                    "splitPercentage": 30.00,
                    "feeBearer": False,
                }
            ]
        },
    },
    "roqqu.initiate_refund": {
        "method": "POST",
        "path": "/api/v1/refunds/initiate-refund",
        "body": {
            "transactionReference": "<the-transaction-reference>",
            "refundReference": "<unique-refund-reference>",
            "refundAmount": 100.00,
            "refundReason": "Order cancelled",
            "customerNote": "Refund for your order",
            "destinationAccountNumber": "3270005594",
            "destinationAccountBankCode": "050",
        },
    },
}

for _defn in ROQQU_NODE_TYPES:
    _tpl = _REQUEST_TEMPLATES.get(_defn.type)
    if _tpl is not None:
        _defn.method = _tpl["method"]
        _defn.path = _tpl["path"]
        _defn.request_template = _tpl["body"]
