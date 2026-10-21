"""The Roqqu provider pack (D13).

Every Roqqu endpoint Studio understands is declared here as a `NodeTypeDef`,
mapping the concrete API onto the neutral capability vocabulary. This is the
only file that must be re-authored to add another payment provider.

Source of truth: the Roqqu API reference, https://developers.roqqu.com
(base URL https://api.roqqu.com/prod/v1, `Authorization: Bearer RQ-SEC-...`).
`when_to_use` lines are condensed from those pages, so Moni reasons from
Roqqu's documented features rather than from training memory.

Roqqu is crypto wallet infrastructure (BTC, ETH, TRX addresses, send and
receive, deposit webhooks) plus fiat KYC, market prices and bill payments. It
has no hosted checkout, card collection, bank payout, batch, split or refund
endpoint. Nodes marked "Studio step" compose documented endpoints (mostly
Generate Wallet and Send Token) so the business templates still work; their
doc link points at the endpoint they are built on.

Traceability: #3 (P1.1 - node catalog), #25 (docs grounding); decision D13.
"""

from __future__ import annotations

from ..ir.types import CapabilityTag as T
from ..ir.types import DomainType as D
from ..ir.types import NodeCategory as C
from .base import NodeTypeDef, PortSpec

DOCS_HOME = "https://developers.roqqu.com"
_REF = f"{DOCS_HOME}/reference"
DOC_GENERATE = f"{_REF}/generate-wallet"
DOC_WALLETS = f"{_REF}/get-wallets-1"
DOC_DELETE = f"{_REF}/delete-wallet-1"
DOC_SEND = f"{_REF}/send-token-1"
DOC_RECEIVE = f"{_REF}/receive-token"
DOC_ADDRESS = f"{_REF}/bitcoin"
DOC_PRICE = f"{_REF}/token-price"
DOC_RESOLVE = f"{_REF}/bank-account-resolve"
DOC_BVN = f"{_REF}/bvn-verify"
DOC_NIN = f"{_REF}/nin-verification"
DOC_AIRTIME = f"{_REF}/airtime-recharge"
DOC_ELECTRIC = f"{_REF}/electricity-meter-recharge"
DOC_METER = f"{_REF}/verify-meter-number"

_COLLECT_OUTPUTS = [
    PortSpec(name="payment_reference", type=D.PAYMENT_REFERENCE),  # the deposit address
    PortSpec(name="checkout_url", type=D.CHECKOUT_URL),  # Studio's deposit page
]
_SEND_TAGS = [T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.BENEFICIARY_TRANSFER, T.SECRET_BOUNDARY]

ROQQU_NODE_TYPES: list[NodeTypeDef] = [
    # --- Wallet --------------------------------------------------------------
    NodeTypeDef(
        type="roqqu.generate_wallet",
        category=C.ROQQU,
        title="Generate Wallet Address",
        description="Create a new BTC, ETH or TRX deposit address for a payment.",
        when_to_use="Collect a crypto payment: give each order its own fresh address so "
        "every deposit maps to exactly one payment. Supports btc, eth and trx only. "
        "Deposits are announced by webhook (Receive Token).",
        doc_url=DOC_GENERATE,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[
            PortSpec(name="amount", type=D.MONEY),
            PortSpec(name="customer", type=D.CUSTOMER, required=False),
        ],
        outputs=_COLLECT_OUTPUTS,
    ),
    NodeTypeDef(
        type="roqqu.get_wallets",
        category=C.ROQQU,
        title="Get Wallets (verify deposit)",
        description="Read total_received for our addresses: the authoritative amount paid.",
        when_to_use="Confirm a deposit server-side after the webhook: look up the address "
        "and read total_received / total_received_usdt. Never trust the webhook body or "
        "the buyer's claim alone. Returns ALL wallets for the token, so call it once per check.",
        doc_url=DOC_WALLETS,
        # This IS the authoritative check - the antidote to trusting a callback.
        default_tags=[T.EXTERNAL_CALL, T.AUTHORITATIVE_VERIFICATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="payment_reference", type=D.PAYMENT_REFERENCE)],
        outputs=[
            PortSpec(name="status", type=D.TRANSACTION_STATUS),
            PortSpec(name="amount_paid", type=D.MONEY),
        ],
    ),
    NodeTypeDef(
        type="roqqu.send_token",
        category=C.ROQQU,
        title="Send Token",
        description="Send crypto from your Roqqu balance to a wallet address.",
        when_to_use="Pay out in crypto: withdrawals, vendor or member payouts. The path "
        "carries the token (send-btc, send-eth, send-trx, ...). `memo` applies to BNB, "
        "EOS, HIVE and STEEM; `tag` to Ripple.",
        doc_url=DOC_SEND,
        default_tags=_SEND_TAGS,
        inputs=[
            PortSpec(name="account_number", type=D.ACCOUNT_NUMBER),  # the destination wallet
            PortSpec(name="amount", type=D.MONEY),
        ],
        outputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
    ),
    NodeTypeDef(
        type="roqqu.delete_wallet",
        category=C.ROQQU,
        title="Delete Wallet",
        description="Remove an address from your wallet list (btc, eth, trx).",
        when_to_use="Retire an address once its order is settled. Roqqu still credits "
        "deposits sent to a deleted address, so never reuse or share it again.",
        doc_url=DOC_DELETE,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="payment_reference", type=D.PAYMENT_REFERENCE)],
    ),
    # --- Studio steps built on Wallet endpoints ------------------------------
    NodeTypeDef(
        type="roqqu.invoice_wallet",
        category=C.ROQQU,
        title="Invoice Wallet",
        description="Studio step: an invoice paid to its own Roqqu deposit address.",
        when_to_use="Trackable invoices with an explicit amount: Studio prices the NGN total "
        "in crypto at Roqqu's live price and opens a fresh address with Generate Wallet. "
        "Roqqu has no invoice endpoint of its own.",
        doc_url=DOC_GENERATE,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[
            PortSpec(name="amount", type=D.MONEY),
            PortSpec(name="customer", type=D.CUSTOMER, required=False),
        ],
        outputs=_COLLECT_OUTPUTS,
    ),
    NodeTypeDef(
        type="roqqu.member_wallet",
        category=C.ROQQU,
        title="Member Wallet",
        description="Studio step: a dedicated deposit address per member (savings, ajo).",
        when_to_use="Savings circles or in-app balances: each member funds a permanent "
        "address of their own, created with Generate Wallet.",
        doc_url=DOC_GENERATE,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="customer", type=D.CUSTOMER)],
        outputs=[PortSpec(name="account_number", type=D.ACCOUNT_NUMBER)],
    ),
    NodeTypeDef(
        type="roqqu.batch_send",
        category=C.ROQQU,
        title="Batch Send",
        description="Studio step: one Send Token call per row (payroll, vendor payouts).",
        when_to_use="Pay a list of people in crypto. Roqqu has no batch endpoint, so Studio "
        "calls Send Token once per row and records each result.",
        doc_url=DOC_SEND,
        # Carries BENEFICIARY_TRANSFER so MON011 demands validation upstream (#54, #24).
        default_tags=_SEND_TAGS,
        inputs=[PortSpec(name="amount", type=D.MONEY)],
        outputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
    ),
    NodeTypeDef(
        type="roqqu.split_send",
        category=C.ROQQU,
        title="Split Send",
        description="Studio step: send each party's share with Send Token right away.",
        when_to_use="Pay several parties from one incoming payment at payment time. It "
        "settles immediately, so it is the wrong tool when payout must wait for fulfilment.",
        doc_url=DOC_SEND,
        # The primitive MON009 warns against for payout-after-fulfilment (D10).
        default_tags=[T.EXTERNAL_CALL, T.IMMEDIATE_SPLIT, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="amount", type=D.MONEY)],
    ),
    NodeTypeDef(
        type="roqqu.refund_send",
        category=C.ROQQU,
        title="Refund (Send Token back)",
        description="Studio step: return a verified payment to the payer's address.",
        when_to_use="Cancellations and disputes: Roqqu has no refund endpoint, so the refund "
        "is a Send Token to the address the buyer gives you.",
        doc_url=DOC_SEND,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="transaction_reference", type=D.TRANSACTION_REFERENCE)],
    ),
    # --- Market & Blockchain -------------------------------------------------
    NodeTypeDef(
        type="roqqu.token_price",
        category=C.ROQQU,
        title="Get Token Price",
        description="Current USD price of a token on Roqqu.",
        when_to_use="Price an NGN or USD amount in crypto before asking a buyer to pay, "
        "or value a payout. No auth needed.",
        doc_url=DOC_PRICE,
        default_tags=[T.EXTERNAL_CALL],
        outputs=[PortSpec(name="amount", type=D.MONEY)],
    ),
    NodeTypeDef(
        type="roqqu.blockchain_address",
        category=C.ROQQU,
        title="Address Lookup (blockchain)",
        description="Live on-chain balance and transactions of an address.",
        when_to_use="Reconcile a payout or deposit against the chain itself. Rate limited to "
        "1 call per 100 seconds; more gets your IP blocked for 10 hours, so never poll it.",
        doc_url=DOC_ADDRESS,
        default_tags=[T.EXTERNAL_CALL, T.RECONCILIATION],
        inputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
        outputs=[PortSpec(name="status", type=D.TRANSACTION_STATUS)],
    ),
    # --- Fiat ----------------------------------------------------------------
    NodeTypeDef(
        type="roqqu.account_resolve",
        category=C.ROQQU,
        title="Bank Account Resolve",
        description="Resolve a Nigerian bank account number to the holder's name.",
        when_to_use="Confirm who you are paying before money moves, so it never lands with "
        "the wrong person. Pass the bank by name, as listed by Get Banks.",
        doc_url=DOC_RESOLVE,
        default_tags=[T.EXTERNAL_CALL, T.BENEFICIARY_VALIDATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="account_number", type=D.ACCOUNT_NUMBER)],
        outputs=[PortSpec(name="account_name", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.bvn_verify",
        category=C.ROQQU,
        title="BVN Verification",
        description="Verify a user's BVN details from the banking system (NGN 20 per success).",
        when_to_use="KYC at onboarding or before large payouts. Charged to your Roqqu "
        "wallet only for successful lookups.",
        doc_url=DOC_BVN,
        default_tags=[T.EXTERNAL_CALL, T.BENEFICIARY_VALIDATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="customer", type=D.CUSTOMER)],
        outputs=[PortSpec(name="account_name", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.nin_verify",
        category=C.ROQQU,
        title="NIN Verification",
        description="Verify a user's NIN details (NGN 100 per success).",
        when_to_use="KYC when the user has no BVN, or as a second check. Charged only for "
        "successful lookups.",
        doc_url=DOC_NIN,
        default_tags=[T.EXTERNAL_CALL, T.BENEFICIARY_VALIDATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="customer", type=D.CUSTOMER)],
        outputs=[PortSpec(name="account_name", type=D.ANY)],
    ),
    # --- Ancillary services --------------------------------------------------
    NodeTypeDef(
        type="roqqu.recharge_airtime",
        category=C.ROQQU,
        title="Airtime Recharge",
        description="Top up airtime on a Nigerian phone number.",
        when_to_use="Rewards, cashback or bill-pay features paid in airtime.",
        doc_url=DOC_AIRTIME,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="amount", type=D.MONEY)],
    ),
    NodeTypeDef(
        type="roqqu.verify_meter",
        category=C.ROQQU,
        title="Verify Meter Number",
        description="Check a meter number and get the customer's name and address.",
        when_to_use="Before buying electricity: confirm the meter exists and belongs to "
        "the right customer, so units never go to a mistyped meter.",
        doc_url=DOC_METER,
        default_tags=[T.EXTERNAL_CALL, T.BENEFICIARY_VALIDATION],
        outputs=[PortSpec(name="account_name", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.pay_electric",
        category=C.ROQQU,
        title="Electricity Meter Recharge",
        description="Buy prepaid or postpaid electricity units (NGN 100 fee per call).",
        when_to_use="Bill-pay features. Verify the meter number first; Roqqu keeps NGN 100 "
        "of the amount as its fee.",
        doc_url=DOC_ELECTRIC,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="amount", type=D.MONEY)],
    ),
]


# Request templates copied from Roqqu's OpenAPI examples (#176, #25). Each is
# the editable request body a dev sees on the block. Paths are relative to
# https://api.roqqu.com/prod/v1. The body rides into node.config (execution +
# codegen already merge it); the analyzer still verifies the graph, so editing
# the request never bypasses the 200-is-not-correct guardrail.
_GENERATE = {"method": "POST", "path": "/user/generate-wallet", "body": {"token": "trx"}}
_SEND = {
    "method": "POST",
    "path": "/user/send-trx",
    "body": {"amount": 10, "wallet": "<destination-address>"},
}
_REQUEST_TEMPLATES: dict[str, dict] = {
    "roqqu.generate_wallet": _GENERATE,
    "roqqu.invoice_wallet": _GENERATE,
    "roqqu.member_wallet": _GENERATE,
    "roqqu.get_wallets": {"method": "POST", "path": "/user/wallets", "body": {"token": "trx"}},
    "roqqu.delete_wallet": {
        "method": "POST",
        "path": "/user/delete-wallet",
        "body": {"token": "trx", "address": "<address-to-delete>"},
    },
    "roqqu.send_token": _SEND,
    "roqqu.batch_send": _SEND,
    "roqqu.split_send": _SEND,
    "roqqu.refund_send": _SEND,
    "roqqu.token_price": {"method": "GET", "path": "/price", "body": {"symbol": "trx"}},
    "roqqu.blockchain_address": {
        "method": "GET",
        "path": "/blockchain/address",
        "body": {"symbol": "trx", "addr": "<address>"},
    },
    "roqqu.account_resolve": {
        "method": "POST",
        "path": "/user/account-resolve",
        "body": {"account_number": "3051559336", "bank": "First Bank of Nigeria Limited"},
    },
    "roqqu.bvn_verify": {
        "method": "POST",
        "path": "/user/bvn-verify",
        "body": {"bvn": "<11-digit-bvn>"},
    },
    "roqqu.nin_verify": {
        "method": "POST",
        "path": "/user/nin-verify",
        "body": {"nin": "<11-digit-nin>"},
    },
    "roqqu.recharge_airtime": {
        "method": "POST",
        "path": "/user/recharge-airtime",
        "body": {"phone_number": "080XXXXXXXX", "amount": 200},
    },
    "roqqu.verify_meter": {
        "method": "GET",
        "path": "/verify-meter",
        "body": {"provider": "ikeja", "meter_type": "prepaid", "meter_number": "45055844760"},
    },
    "roqqu.pay_electric": {
        "method": "POST",
        "path": "/user/pay-electric",
        "body": {
            "provider": "ikeja",
            "meter_type": "prepaid",
            "meter_number": "45055844760",
            "amount": 500,
            "phone_number": "080XXXXXXXX",
        },
    },
}

for _defn in ROQQU_NODE_TYPES:
    _tpl = _REQUEST_TEMPLATES.get(_defn.type)
    if _tpl is not None:
        _defn.method = _tpl["method"]
        _defn.path = _tpl["path"]
        _defn.request_template = dict(_tpl["body"])
