# Roqqu Studio: RAS migration + business accounts, wallets, store and Pay now

Date: 2026-10-22. Status: approved in chat ("start building").

## Why

The team asked for six things: frictionless business onboarding, a store with product
images, an automatic wallet per business (receive + send), a "Pay now" button that opens a
browser wallet, a Neon database, and moving to the correct Roqqu docs
(https://roqqu-api-services.gitbook.io/ras).

The old API (`api.roqqu.com/prod/v1`, `Authorization: Bearer RQ-SEC-…`) returns 502. The
Roqqu API Service (RAS) is live: `https://service.roqqu.com/v1`, header `x-api-key` (live)
or `x-staging-api-key` (test), envelope `{status: "success"|"fail", message, data}`.

## Decisions

| # | Decision |
|---|---|
| D1 | Tools RAS cannot back (KYC BVN/NIN, account resolve, bills, airtime, data) are removed. |
| D2 | Onboarding asks owner name, business name, email. No password: httpOnly session cookie; other devices sign in with an emailed one-time link. |
| D3 | Email: Brevo (free, single verified sender) when `BREVO_API_KEY` is set, else ZeptoMail, else the link/code is logged (dev). |
| D4 | Product photos live in Neon (`bytea`), resized client-side to WebP, max 200 KB. |
| D5 | Every invoice / store purchase gets its own RAS payment link (NGN priced, pre-generated bitcoin/trc20/bep20 addresses). |
| D6 | Withdrawals need an emailed 6-digit code (10 min, 5 tries) and respect a daily USD cap `BIZ_DAILY_SEND_USD` (default 500). |
| D7 | Business features live in Next.js route handlers (`apps/web`), MemoPay style. Canvas, playground and codegen stay in Python and move to RAS too. |
| D8 | Wallets are custodial under the platform's RAS merchant account. Per-business balances are a ledger in Neon. |

## Modes

- `practice` – no key; every RAS call is simulated deterministically.
- `test` – `RAS_TEST_KEY`, header `x-staging-api-key`.
- `live` – `RAS_LIVE_KEY`, header `x-api-key`; refused unless `ALLOW_PRODUCTION_EXECUTION=true`.

Mode = `RAS_MODE` env if set, else `test` when `RAS_TEST_KEY` exists, else `practice`.

## Sub-project A: Python RAS migration

- `integrations/roqqu/client.py` targets RAS (base URL, headers, form/json bodies, envelope
  `fail` → error). `endpoints.json` is rewritten from the RAS docs (all documented endpoints).
- Playground, codegen (Python + JS) and canvas providers use the RAS paths.
- Webhook verification becomes AES-256-CTR decryption: key = first 32 chars of the API key,
  IV = hex from the `x-api-key` request header, ciphertext = hex `body.hash`.
- KYC / bills / data panels, nodes and templates removed (D1).

## Sub-project B: Neon, onboarding, business wallets (apps/web)

Tables (`apps/web/db/schema.sql`): `businesses`, `login_tokens`, `wallets`,
`products`, `invoices`, `ledger`, `sends`, `webhook_events`.

- `POST /api/biz/onboard` {owner_name, business_name, email} → business + signed session cookie (JWT, `SESSION_SECRET`);
  then wallets for bep20/usdt, trc20/usdt, bitcoin/btc via `/wallets/generate-wallet`
  (customer = business email + owner name). Failure leaves a "Retry wallet setup" banner.
- `POST /api/biz/login` {email} → emails a one-time link; `GET /api/biz/login/{token}` signs in.
- Balance per token = `sum(ledger.amount)`.
- Sends: `POST /api/biz/sends` (validate address via `/wallets/what-network`, balance incl.
  `/transaction/network-fee`, daily cap) → emails code; `POST /api/biz/sends/{id}/confirm`
  debits ledger, calls `/wallets/send`, stores `refid`; on RAS failure the debit is reversed.

## Sub-project C: store, invoices, Pay now

- Products CRUD with photo. Public store `/s/{slug}`; "Buy" collects customer name + email,
  creates an invoice for that product, redirects to `/pay/{invoice_id}`.
- Invoice create → `POST /payment-links` (`amount_currency=ngn`, wallets pre-generated,
  `payment_reference` ≤ 20 alphanumerics, `metadata={business_id, invoice_id}`). Expired links
  (2 h default) are re-created on view.
- Invoice page shows business name, owner name, items, NGN total, "Settles to" (business bep20
  wallet), Pay now (MetaMask → BNB Smart Chain, USDT `transfer` to the invoice's bep20 address;
  amount = NGN ÷ RAS `/rates` USDT/NGN, rounded up to 2 dp), and "Pay with BTC / Tron" → Roqqu
  hosted link. Page polls status every 5 s.
- Webhook `POST /api/ras/webhook`: decrypt, dedupe by `event_id`, then
  `payment_link_completed[_overpaid]` → invoice paid + ledger credit;
  `payment_link_failed` → invoice underpaid + credit what arrived;
  `token_received` on a business wallet → credit; `token_sent` → send sent;
  `token_refunded` → send refunded + credit back. Other events forwarded to the Python API.
  Always 200.

## Testing

- Python: client header/mode tests, webhook decrypt round-trip, codegen `node --check`.
- Web (vitest): decrypt round-trip, ledger math, NGN→USDT rounding, payment reference format,
  webhook handler idempotency with an in-memory SQL fake (PGlite).
- E2E (Playwright, practice mode): onboard → dashboard shows wallets → create product with photo
  → store → buy → invoice page → simulated webhook → paid.

## Out of scope

TronLink / Bitcoin browser wallets, multi-user businesses, fiat payouts, buy/sell/swap UI.
