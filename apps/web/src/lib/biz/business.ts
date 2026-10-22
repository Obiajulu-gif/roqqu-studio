/**
 * Businesses, their RAS wallets and balances. A business is created from three
 * fields (owner name, business name, email); its wallets are generated right
 * after, on every network a payment link uses.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { db } from "./db";
import { generateWallet, NETWORKS, type Customer, type Network } from "./ras";
import { hashToken, newSecretToken } from "./session";
import { slugify } from "./money";

export interface Business {
  id: string;
  slug: string;
  owner_name: string;
  business_name: string;
  email: string;
  wallet_status: "pending" | "ready" | "failed";
  wallet_error: string | null;
  created_at: Date;
}

export interface Wallet {
  network: Network;
  token: string;
  address: string;
}

export class BizError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanOnboarding(input: { owner_name?: unknown; business_name?: unknown; email?: unknown }) {
  const owner = String(input.owner_name ?? "").trim().replace(/\s+/g, " ");
  const business = String(input.business_name ?? "").trim().replace(/\s+/g, " ");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (owner.length < 2 || owner.length > 80) throw new BizError("Enter your name (2 to 80 characters).");
  if (business.length < 2 || business.length > 80) throw new BizError("Enter your business name (2 to 80 characters).");
  if (!EMAIL_RE.test(email) || email.length > 120) throw new BizError("Enter a valid email address.");
  return { owner_name: owner, business_name: business, email };
}

/** RAS customer details for the owner: first word is the first name, the rest the last. */
export function ownerAsCustomer(b: Pick<Business, "owner_name" | "email">): Customer {
  const [first, ...rest] = b.owner_name.split(" ");
  return { email: b.email, first_name: first, last_name: rest.join(" ") || first };
}

export async function createBusiness(input: { owner_name: string; business_name: string; email: string }): Promise<Business> {
  const sql = db();
  const [existing] = await sql<{ id: string }[]>`select id from businesses where email = ${input.email}`;
  if (existing) throw new BizError("This email already has a business. Use “Sign in” to get a sign-in link.", 409);
  const base = slugify(input.business_name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString("hex")}`;
    const rows = await sql<Business[]>`
      insert into businesses (id, slug, owner_name, business_name, email)
      values (${randomUUID()}, ${slug}, ${input.owner_name}, ${input.business_name}, ${input.email})
      on conflict do nothing
      returning *`;
    if (rows[0]) return rows[0];
  }
  throw new BizError("Could not reserve a store name. Try a slightly different business name.", 409);
}

export async function getBusiness(id: string): Promise<Business | null> {
  const [row] = await db()<Business[]>`select * from businesses where id = ${id}`;
  return row ?? null;
}

export async function getBusinessBySlug(slug: string): Promise<Business | null> {
  const [row] = await db()<Business[]>`select * from businesses where slug = ${slug.toLowerCase()}`;
  return row ?? null;
}

export async function getWallets(businessId: string): Promise<Wallet[]> {
  return db()<Wallet[]>`select network, token, address from wallets where business_id = ${businessId} order by network`;
}

/**
 * Create any missing wallets. Never throws: a failure is recorded on the
 * business so the dashboard can offer "Retry wallet setup".
 */
export async function setupWallets(business: Business): Promise<Business> {
  const sql = db();
  const have = new Set((await getWallets(business.id)).map((w) => w.network));
  try {
    for (const n of NETWORKS) {
      if (have.has(n.network)) continue;
      const address = await generateWallet(n.network, ownerAsCustomer(business));
      await sql`insert into wallets (business_id, network, token, address)
                values (${business.id}, ${n.network}, ${n.token}, ${address})
                on conflict do nothing`;
    }
    const [row] = await sql<Business[]>`update businesses set wallet_status = 'ready', wallet_error = null
                                         where id = ${business.id} returning *`;
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : "wallet setup failed";
    const [row] = await sql<Business[]>`update businesses set wallet_status = 'failed', wallet_error = ${message}
                                         where id = ${business.id} returning *`;
    return row;
  }
}

/** Balance per token, from the ledger. */
export async function balances(businessId: string): Promise<Record<string, string>> {
  const rows = await db()<{ token: string; total: string }[]>`
    select token, coalesce(sum(amount), 0)::text as total from ledger where business_id = ${businessId} group by token`;
  const out: Record<string, string> = { usdt: "0", btc: "0" };
  for (const r of rows) out[r.token] = r.total;
  return out;
}

export async function recentLedger(businessId: string, limit = 20) {
  return db()<{ token: string; amount: string; kind: string; ref: string; created_at: Date }[]>`
    select token, amount::text, kind, ref, created_at from ledger
    where business_id = ${businessId} order by created_at desc, id desc limit ${limit}`;
}

/* --- sign-in links ------------------------------------------------------------- */

/** A one-time link token for this email's business, valid 20 minutes (null if no business). */
export async function createLoginToken(email: string): Promise<{ raw: string; business: Business } | null> {
  const sql = db();
  const [business] = await sql<Business[]>`select * from businesses where email = ${email.trim().toLowerCase()}`;
  if (!business) return null;
  const { raw, hash } = newSecretToken();
  await sql`insert into login_tokens (token_hash, business_id, expires_at)
            values (${hash}, ${business.id}, now() + interval '20 minutes')`;
  return { raw, business };
}

/** Spend a sign-in link: the business id once, then never again. */
export async function consumeLoginToken(raw: string): Promise<string | null> {
  const [row] = await db()<{ business_id: string }[]>`
    update login_tokens set used_at = now()
    where token_hash = ${hashToken(raw)} and used_at is null and expires_at > now()
    returning business_id`;
  return row?.business_id ?? null;
}
