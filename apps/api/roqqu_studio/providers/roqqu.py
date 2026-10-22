"""The Roqqu provider pack (D13).

Every Roqqu endpoint Studio understands is declared here as a `NodeTypeDef`,
mapping the concrete API onto the neutral capability vocabulary. This is the
only file that must be re-authored to add another payment provider.

Source of truth: the Roqqu API Service docs, https://roqqu-api-services.gitbook.io/ras
(base URL https://service.roqqu.com/v1, `x-api-key` live or `x-staging-api-key` test).
`when_to_use` lines are condensed from those pages, so Rooky reasons from
Roqqu's documented features rather than from training memory.

RAS is crypto wallet infrastructure: customer and merchant addresses on bitcoin,
erc20, bep20, trc20, solana, ripple, litecoin, base and dogecoin; send; NGN-priced
payment links; balances, trades, prices and fiat rates; encrypted webhooks. It has
no batch or split endpoint. Nodes marked "Studio step" compose documented
endpoints (mostly Generate Wallet and Send) so the business templates still work;
their doc link points at the endpoint they are built on.

Traceability: #3 (P1.1 - node catalog), #25 (docs grounding); decision D13.
"""

from __future__ import annotations

from ..ir.types import CapabilityTag as T
from ..ir.types import DomainType as D
from ..ir.types import NodeCategory as C
from .base import NodeTypeDef, PortSpec

DOCS_HOME = "https://roqqu-api-services.gitbook.io/ras"
DOC_GENERATE = f"{DOCS_HOME}/wallets/generate-wallet"
DOC_WALLETS = f"{DOCS_HOME}/wallets/get-addresses"
DOC_DELETE = f"{DOCS_HOME}/wallets/delete-wallet"
DOC_SEND = f"{DOCS_HOME}/wallets/send-coin"
DOC_RECEIVE = f"{DOCS_HOME}/webhooks/coin-webhook-events"
DOC_WHAT_NETWORK = f"{DOCS_HOME}/wallets/what-network"
DOC_PRICES = f"{DOCS_HOME}/market-data/get-crypto-prices"
DOC_RATES = f"{DOCS_HOME}/market-data/get-fiat-rates"
DOC_PAYMENT_LINK = f"{DOCS_HOME}/payment-links/create-payment-link"
DOC_BALANCES = f"{DOCS_HOME}/balances/get-crypto-balances"
DOC_NETWORK_FEE = f"{DOCS_HOME}/transaction/get-network-fees"
DOC_SEND_RECORD = f"{DOCS_HOME}/transaction/get-send-withdrawal-queue-record-by-reference-id"
DOC_SWAP = f"{DOCS_HOME}/trade/swap"

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
        description="Create a deposit address on a network (bitcoin, trc20, bep20, erc20, ...).",
        when_to_use="Collect crypto: give each customer or order its own address so every "
        "deposit maps to one payer. RAS needs the customer's email, first_name and "
        "last_name. Deposits arrive by the encrypted token_received webhook.",
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
        title="Get Addresses (verify deposit)",
        description="Read total_received for our addresses: the authoritative amount paid.",
        when_to_use="Confirm a deposit server-side after the webhook: look up the address "
        "and read total_received. Never trust the webhook body or the buyer's claim alone. "
        "Returns every address on the network, so call it once per check.",
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
        title="Send Coin",
        description="Send crypto from your Roqqu balance to an address (POST /wallets/send).",
        when_to_use="Pay out in crypto: withdrawals, vendor or member payouts. Give amount, "
        "network, to and token. Fees come out of the token sent. RAS returns a refid at once; "
        "on-chain confirmation arrives later as the token_sent webhook.",
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
        description="Remove an address from your address list (network + address).",
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
        "in crypto at Roqqu's live price and NGN rate and opens a fresh address with Generate "
        "Wallet. For a hosted checkout use Create Payment Link instead.",
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
        description="Studio step: one Send call per row (payroll, vendor payouts).",
        when_to_use="Pay a list of people in crypto. RAS has no batch endpoint, so Studio "
        "calls Send once per row and records each result.",
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
        description="Studio step: send each party's share with Send right away.",
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
        title="Refund (send back)",
        description="Studio step: return a verified payment to the payer's address.",
        when_to_use="Cancellations and disputes: RAS refunds only failed sends, so "
        "a customer refund is a Send to the address the buyer gives you.",
        doc_url=DOC_SEND,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="transaction_reference", type=D.TRANSACTION_REFERENCE)],
    ),
    # --- Payment links --------------------------------------------------------
    NodeTypeDef(
        type="roqqu.payment_link",
        category=C.ROQQU,
        title="Create Payment Link",
        description="A hosted Roqqu checkout priced in NGN, payable in BTC, USDT (TRC20) or USDT (BEP20).",
        when_to_use="Invoices, store checkouts and one-off payments: RAS prices the NGN amount, "
        "generates a unique address per network and reports completed, overpaid or underpaid "
        "by webhook. payment_reference is 1-20 letters and numbers; links expire after 2 hours "
        "unless expires_at is set.",
        doc_url=DOC_PAYMENT_LINK,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        inputs=[
            PortSpec(name="amount", type=D.MONEY),
            PortSpec(name="customer", type=D.CUSTOMER, required=False),
        ],
        outputs=_COLLECT_OUTPUTS,
    ),
    # --- Market, balances & transactions ----------------------------------------
    NodeTypeDef(
        type="roqqu.token_price",
        category=C.ROQQU,
        title="Get Token Price",
        description="Current USD price of a token on Roqqu (GET /prices).",
        when_to_use="Price an NGN or USD amount in crypto before asking a buyer to pay, "
        "or value a payout. Public, no key needed.",
        doc_url=DOC_PRICES,
        default_tags=[T.EXTERNAL_CALL],
        outputs=[PortSpec(name="amount", type=D.MONEY)],
    ),
    NodeTypeDef(
        type="roqqu.all_prices",
        category=C.ROQQU,
        title="Get All Prices",
        description="USD price and 24h change of every token on Roqqu.",
        when_to_use="Rate boards, price alerts and portfolio values. Public, no key needed.",
        doc_url=DOC_PRICES,
        default_tags=[T.EXTERNAL_CALL],
        outputs=[PortSpec(name="amount", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.fiat_rates",
        category=C.ROQQU,
        title="Get Fiat Rates",
        description="Live NGN, GBP, EUR and GHS per USD, with Roqqu's min/max limits.",
        when_to_use="Convert a naira amount to USD (and then to a token) at Roqqu's own rate. "
        "Public, updated every minute.",
        doc_url=DOC_RATES,
        default_tags=[T.EXTERNAL_CALL],
        outputs=[PortSpec(name="amount", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.blockchain_address",
        category=C.ROQQU,
        title="Check Address (What Network)",
        description="Which networks a destination address belongs to; empty means it is not a real address.",
        when_to_use="Validate a payout address before any send: the address must belong to the "
        "network you send on, or RAS rejects it (or funds go astray on a lookalike chain).",
        doc_url=DOC_WHAT_NETWORK,
        default_tags=[T.EXTERNAL_CALL, T.RECONCILIATION, T.BENEFICIARY_VALIDATION],
        inputs=[PortSpec(name="account_number", type=D.ACCOUNT_NUMBER, required=False)],
        outputs=[PortSpec(name="status", type=D.TRANSACTION_STATUS)],
    ),
    NodeTypeDef(
        type="roqqu.balances",
        category=C.ROQQU,
        title="Get Balances",
        description="Your merchant balance for every token (POST /balances).",
        when_to_use="Check you can cover a payout before sending, or show a treasury view.",
        doc_url=DOC_BALANCES,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        outputs=[PortSpec(name="amount", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.network_fee",
        category=C.ROQQU,
        title="Get Network Fee",
        description="Estimated on-chain fee for one send on a network.",
        when_to_use="Fees are taken from the token you send, so add this before checking a "
        "balance covers a payout.",
        doc_url=DOC_NETWORK_FEE,
        default_tags=[T.EXTERNAL_CALL, T.SECRET_BOUNDARY],
        outputs=[PortSpec(name="amount", type=D.ANY)],
    ),
    NodeTypeDef(
        type="roqqu.tx_status",
        category=C.ROQQU,
        title="Get Send Status",
        description="The queued send record for a refid: queued, sent or refunded.",
        when_to_use="Reconcile payouts: Send returns a refid at once and confirms on-chain "
        "later (token_sent webhook). Check the record instead of assuming success.",
        doc_url=DOC_SEND_RECORD,
        default_tags=[T.EXTERNAL_CALL, T.RECONCILIATION, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="transfer_reference", type=D.TRANSFER_REFERENCE)],
        outputs=[PortSpec(name="status", type=D.TRANSACTION_STATUS)],
    ),
    NodeTypeDef(
        type="roqqu.swap",
        category=C.ROQQU,
        title="Swap Tokens",
        description="Swap one token in your balance for another, e.g. BTC to ETH (USDT uses buy/sell).",
        when_to_use="Rebalance a treasury. Swaps are ledger-only and emit no webhook, so confirm "
        "the result with Get Balances.",
        doc_url=DOC_SWAP,
        default_tags=[T.EXTERNAL_CALL, T.MONEY_MOVEMENT, T.SECRET_BOUNDARY],
        inputs=[PortSpec(name="amount", type=D.MONEY, required=False)],
    ),
]


# Request templates copied from the RAS docs' examples (#176, #25). Each is the
# editable request body a dev sees on the block. Paths are relative to
# https://service.roqqu.com/v1. The body rides into node.config (execution +
# codegen already merge it); the analyzer still verifies the graph, so editing
# the request never bypasses the 200-is-not-correct guardrail.
_CUSTOMER = {"email": "jean@email.com", "first_name": "Jean", "last_name": "Billy"}
_GENERATE = {
    "method": "POST",
    "path": "/wallets/generate-wallet",
    "body": {"network": "trc20", "customer": _CUSTOMER},
}
_SEND = {
    "method": "POST",
    "path": "/wallets/send",
    "body": {"amount": 2, "network": "trc20", "to": "<destination-address>", "token": "usdt"},
}
_REQUEST_TEMPLATES: dict[str, dict] = {
    "roqqu.generate_wallet": _GENERATE,
    "roqqu.invoice_wallet": _GENERATE,
    "roqqu.member_wallet": _GENERATE,
    "roqqu.get_wallets": {"method": "POST", "path": "/wallets/get-addresses", "body": {"network": "trc20"}},
    "roqqu.delete_wallet": {
        "method": "DELETE",
        "path": "/wallets/delete",
        "body": {"network": "trc20", "address": "<address-to-delete>"},
    },
    "roqqu.send_token": _SEND,
    "roqqu.batch_send": _SEND,
    "roqqu.split_send": _SEND,
    "roqqu.refund_send": _SEND,
    "roqqu.payment_link": {
        "method": "POST",
        "path": "/payment-links",
        "body": {
            "amount": 1000,
            "amount_currency": "ngn",
            "customer_details": _CUSTOMER,
            "payment_reference": "ORDER123ABC",
            "success_url": "https://yourwebsite.com/payment/success",
            "cancel_url": "https://yourwebsite.com/payment/cancel",
        },
    },
    "roqqu.token_price": {"method": "GET", "path": "/prices", "body": {"symbol": "btc"}},
    "roqqu.all_prices": {"method": "GET", "path": "/prices", "body": {}},
    "roqqu.fiat_rates": {"method": "GET", "path": "/rates", "body": {}},
    "roqqu.blockchain_address": {
        "method": "POST",
        "path": "/wallets/what-network",
        "body": {"address": "<destination-address>"},
    },
    "roqqu.balances": {"method": "POST", "path": "/balances", "body": {"token": "usdt"}},
    "roqqu.network_fee": {"method": "POST", "path": "/transaction/network-fee", "body": {"network": "bep20"}},
    "roqqu.tx_status": {"method": "GET", "path": "/transaction/refId/<refid>", "body": {}},
    "roqqu.swap": {"method": "POST", "path": "/trade/swap", "body": {"amount": 0.001, "from": "btc", "to": "eth"}},
}

for _defn in ROQQU_NODE_TYPES:
    _tpl = _REQUEST_TEMPLATES.get(_defn.type)
    if _tpl is not None:
        _defn.method = _tpl["method"]
        _defn.path = _tpl["path"]
        _defn.request_template = dict(_tpl["body"])
