-- Roqqu Studio business data (Neon / any Postgres). Safe to re-run.
-- Apply: npm run db:migrate  (uses DATABASE_URL)

create table if not exists businesses (
  id             uuid primary key,
  slug           text not null unique,            -- public store URL: /s/{slug}
  owner_name     text not null,
  business_name  text not null,
  email          text not null unique,            -- lowercased; RAS needs it for customer wallets
  wallet_status  text not null default 'pending' check (wallet_status in ('pending', 'ready', 'failed')),
  wallet_error   text,
  created_at     timestamptz not null default now()
);

-- One-time sign-in links (stored hashed) for returning on another device.
create table if not exists login_tokens (
  token_hash   text primary key,
  business_id  uuid not null references businesses(id) on delete cascade,
  expires_at   timestamptz not null,
  used_at      timestamptz
);

-- The business's own RAS addresses (one per network), created at onboarding.
create table if not exists wallets (
  business_id  uuid not null references businesses(id) on delete cascade,
  network      text not null check (network in ('bep20', 'trc20', 'bitcoin')),
  token        text not null,
  address      text not null unique,
  created_at   timestamptz not null default now(),
  primary key (business_id, network)
);

create table if not exists products (
  id            uuid primary key,
  business_id   uuid not null references businesses(id) on delete cascade,
  name          text not null,
  description   text not null default '',
  price_ngn     numeric(14, 2) not null check (price_ngn > 0),
  photo         bytea,                             -- WebP, resized in the browser (<= 200 KB)
  photo_type    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists products_business_idx on products (business_id, created_at desc);

create table if not exists invoices (
  id                 uuid primary key,
  business_id        uuid not null references businesses(id) on delete cascade,
  number             text not null,                -- per-business sequence, e.g. INV-0001
  product_id         uuid references products(id) on delete set null,
  customer_name      text not null,
  customer_email     text not null,
  items              jsonb not null,               -- [{description, quantity, unit_ngn}]
  total_ngn          numeric(14, 2) not null check (total_ngn > 0),
  reference          text not null unique,         -- RAS payment_reference (1-20 alphanumerics)
  link_refid         text,                         -- RAS payment link refid
  link_url           text,                         -- Roqqu hosted checkout
  link_wallets       jsonb not null default '[]',  -- [{network, token, address}]
  link_expires_at    timestamptz,
  status             text not null default 'open' check (status in ('open', 'paid', 'overpaid', 'underpaid', 'void')),
  paid_token         text,
  paid_amount        numeric(30, 10),
  paid_hash          text,
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  unique (business_id, number)
);
create index if not exists invoices_business_idx on invoices (business_id, created_at desc);

-- Money in and out per business. A balance is sum(amount) per token.
create table if not exists ledger (
  id           bigserial primary key,
  business_id  uuid not null references businesses(id) on delete cascade,
  token        text not null,                      -- usdt | btc
  amount       numeric(30, 10) not null,           -- + credit, - debit
  kind         text not null,                      -- payment | deposit | send | send_reversal | refund
  ref          text not null,                      -- invoice id, tx hash or send id
  created_at   timestamptz not null default now(),
  unique (business_id, kind, ref)                  -- the same event can never post twice
);
create index if not exists ledger_business_idx on ledger (business_id, token);

create table if not exists sends (
  id            uuid primary key,
  business_id   uuid not null references businesses(id) on delete cascade,
  network       text not null,
  token         text not null,
  to_address    text not null,
  amount        numeric(30, 10) not null check (amount > 0),
  amount_usd    numeric(14, 2) not null,
  code_hash     text not null,                     -- emailed 6-digit code, hashed
  code_expires  timestamptz not null,
  attempts      int not null default 0,
  status        text not null default 'awaiting_code'
                check (status in ('awaiting_code', 'queued', 'sent', 'refunded', 'failed', 'expired')),
  refid         text unique,                       -- RAS queue reference
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists sends_business_idx on sends (business_id, created_at desc);

-- Every RAS webhook event we processed, so retries never double-count.
create table if not exists webhook_events (
  event_id     text primary key,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);
