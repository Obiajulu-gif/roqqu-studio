/**
 * Products (the store) and invoices. Every invoice, including a store
 * purchase, gets its own RAS payment link priced in naira, so each payment is
 * matched to exactly one invoice by its payment_reference.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { BizError, getWallets, type Business } from "./business";
import { db } from "./db";
import { koboToNaira, ngnToUsdt, paymentReference, toKobo } from "./money";
import { createPaymentLink, ngnPerUsd, type LinkWallet } from "./ras";

export const MAX_PHOTO_BYTES = 200 * 1024;
const PHOTO_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);

export interface Product {
  id: string;
  name: string;
  description: string;
  price_ngn: string;
  has_photo: boolean;
  active: boolean;
  created_at: Date;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unit_ngn: string;
}

export interface Invoice {
  id: string;
  business_id: string;
  number: string;
  product_id: string | null;
  customer_name: string;
  customer_email: string;
  items: InvoiceItem[];
  total_ngn: string;
  reference: string;
  link_refid: string | null;
  link_url: string | null;
  link_wallets: LinkWallet[];
  link_expires_at: Date | null;
  status: "open" | "paid" | "overpaid" | "underpaid" | "void";
  paid_token: string | null;
  paid_amount: string | null;
  paid_at: Date | null;
  created_at: Date;
}

const PRODUCT_COLS = "id, name, description, price_ngn::text as price_ngn, photo is not null as has_photo, active, created_at";
const INVOICE_COLS = `id, business_id, number, product_id, customer_name, customer_email, items, total_ngn::text as total_ngn,
  reference, link_refid, link_url, link_wallets, link_expires_at, status, paid_token, paid_amount::text as paid_amount, paid_at, created_at`;

/* --- products ------------------------------------------------------------------- */

/** "data:image/webp;base64,..." -> bytes, checked for type and size. */
export function decodePhoto(dataUrl: unknown): { bytes: Buffer; type: string } | null {
  if (dataUrl === undefined || dataUrl === null || dataUrl === "") return null;
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m || !PHOTO_TYPES.has(m[1])) throw new BizError("Use a JPG, PNG or WebP photo.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_PHOTO_BYTES) throw new BizError("That photo is too large. Use one under 200 KB.");
  return { bytes, type: m[1] };
}

export async function createProduct(businessId: string, input: Record<string, unknown>): Promise<Product> {
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  const kobo = toKobo(String(input.price_ngn ?? ""));
  if (name.length < 2 || name.length > 80) throw new BizError("Give the product a name (2 to 80 characters).");
  if (description.length > 500) throw new BizError("Keep the description under 500 characters.");
  if (kobo === null || kobo < 10_000) throw new BizError("Set a price of at least ₦100.");
  const photo = decodePhoto(input.photo);
  const [row] = await db()<Product[]>`
    insert into products (id, business_id, name, description, price_ngn, photo, photo_type)
    values (${randomUUID()}, ${businessId}, ${name}, ${description}, ${koboToNaira(kobo)},
            ${photo?.bytes ?? null}, ${photo?.type ?? null})
    returning ${db().unsafe(PRODUCT_COLS)}`;
  return row;
}

export async function listProducts(businessId: string, onlyActive = false): Promise<Product[]> {
  return db()<Product[]>`
    select ${db().unsafe(PRODUCT_COLS)} from products
    where business_id = ${businessId} ${onlyActive ? db()`and active` : db()``}
    order by created_at desc`;
}

export async function setProductActive(businessId: string, id: string, active: boolean): Promise<Product | null> {
  const [row] = await db()<Product[]>`
    update products set active = ${active} where id = ${id} and business_id = ${businessId}
    returning ${db().unsafe(PRODUCT_COLS)}`;
  return row ?? null;
}

export async function deleteProduct(businessId: string, id: string): Promise<boolean> {
  const rows = await db()`delete from products where id = ${id} and business_id = ${businessId} returning id`;
  return rows.length > 0;
}

export async function productPhoto(id: string): Promise<{ photo: Buffer; photo_type: string } | null> {
  const [row] = await db()<{ photo: Buffer; photo_type: string }[]>`
    select photo, photo_type from products where id = ${id} and photo is not null`;
  return row ?? null;
}

/* --- invoices --------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanCustomer(input: Record<string, unknown>) {
  const name = String(input.customer_name ?? "").trim().replace(/\s+/g, " ");
  const email = String(input.customer_email ?? "").trim().toLowerCase();
  if (name.length < 2 || name.length > 80) throw new BizError("Enter the customer's name.");
  if (!EMAIL_RE.test(email)) throw new BizError("Enter the customer's email. Roqqu sends the payment receipt there.");
  return { name, email };
}

function cleanItems(raw: unknown): { items: InvoiceItem[]; totalKobo: number } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 30) throw new BizError("Add at least one item.");
  let totalKobo = 0;
  const items = raw.map((r: Record<string, unknown>, i) => {
    const description = String(r.description ?? "").trim();
    const quantity = Number(r.quantity ?? 1);
    const unit = toKobo(String(r.unit_ngn ?? ""));
    if (!description) throw new BizError(`Item ${i + 1} needs a description.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) throw new BizError(`Item ${i + 1}: quantity must be a whole number.`);
    if (unit === null) throw new BizError(`Item ${i + 1}: enter a price.`);
    totalKobo += unit * quantity;
    return { description, quantity, unit_ngn: koboToNaira(unit) };
  });
  if (totalKobo < 10_000) throw new BizError("An invoice must be at least ₦100.");
  return { items, totalKobo };
}

async function nextNumber(businessId: string): Promise<string> {
  const [{ n }] = await db()<{ n: number }[]>`select count(*)::int + 1 as n from invoices where business_id = ${businessId}`;
  return `INV-${String(n).padStart(4, "0")}`;
}

function nameParts(full: string) {
  const [first, ...rest] = full.split(" ");
  return { first_name: first, last_name: rest.join(" ") || first };
}

/** Create the invoice and its Roqqu payment link. */
export async function createInvoice(
  business: Business,
  input: Record<string, unknown>,
  origin: string,
  productId: string | null = null,
): Promise<Invoice> {
  const customer = cleanCustomer(input);
  const { items, totalKobo } = cleanItems(input.items);
  const id = randomUUID();
  const reference = paymentReference("INV", randomBytes(12).toString("hex"));
  const link = await createPaymentLink({
    amountNgn: koboToNaira(totalKobo),
    reference,
    customer: { email: customer.email, ...nameParts(customer.name) },
    successUrl: `${origin}/pay/${id}?done=1`,
    cancelUrl: `${origin}/pay/${id}`,
    metadata: { business_id: business.id, invoice_id: id },
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await db()<Invoice[]>`
      insert into invoices (id, business_id, number, product_id, customer_name, customer_email, items, total_ngn,
                            reference, link_refid, link_url, link_wallets, link_expires_at)
      values (${id}, ${business.id}, ${await nextNumber(business.id)}, ${productId}, ${customer.name}, ${customer.email},
              ${db().json(items as never)}, ${koboToNaira(totalKobo)}, ${reference}, ${link.refid}, ${link.payment_link},
              ${db().json(link.wallets as never)}, ${link.expires_at})
      on conflict (business_id, number) do nothing
      returning ${db().unsafe(INVOICE_COLS)}`;
    if (rows[0]) return rows[0];
  }
  throw new BizError("Could not number the invoice. Try again.", 409);
}

/** A buyer on the public store picks one product. */
export async function buyProduct(business: Business, input: Record<string, unknown>, origin: string): Promise<Invoice> {
  const [product] = await db()<Product[]>`
    select ${db().unsafe(PRODUCT_COLS)} from products
    where id = ${String(input.product_id ?? "")} and business_id = ${business.id} and active`;
  if (!product) throw new BizError("That product is no longer for sale.", 404);
  const quantity = Math.max(1, Math.min(100, Number(input.quantity ?? 1) | 0));
  return createInvoice(
    business,
    { ...input, items: [{ description: product.name, quantity, unit_ngn: product.price_ngn }] },
    origin,
    product.id,
  );
}

export async function listInvoices(businessId: string): Promise<Invoice[]> {
  return db()<Invoice[]>`
    select ${db().unsafe(INVOICE_COLS)} from invoices where business_id = ${businessId}
    order by created_at desc limit 100`;
}

export async function getInvoice(id: string): Promise<Invoice | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db()<Invoice[]>`select ${db().unsafe(INVOICE_COLS)} from invoices where id = ${id}`;
  return row ?? null;
}

/** Payment links expire (2 hours by default): an open invoice gets a fresh one on view. */
export async function ensureFreshLink(invoice: Invoice, origin: string): Promise<Invoice> {
  const expired = invoice.link_expires_at && new Date(invoice.link_expires_at).getTime() < Date.now() + 60_000;
  if (invoice.status !== "open" || !expired) return invoice;
  const reference = paymentReference("INV", randomBytes(12).toString("hex"));
  const link = await createPaymentLink({
    amountNgn: invoice.total_ngn,
    reference,
    customer: { email: invoice.customer_email, ...nameParts(invoice.customer_name) },
    successUrl: `${origin}/pay/${invoice.id}?done=1`,
    cancelUrl: `${origin}/pay/${invoice.id}`,
    metadata: { business_id: invoice.business_id, invoice_id: invoice.id },
  });
  const [row] = await db()<Invoice[]>`
    update invoices set reference = ${reference}, link_refid = ${link.refid}, link_url = ${link.payment_link},
      link_wallets = ${db().json(link.wallets as never)}, link_expires_at = ${link.expires_at}
    where id = ${invoice.id} and status = 'open'
    returning ${db().unsafe(INVOICE_COLS)}`;
  return row ?? invoice;
}

/** Everything the public invoice page needs, including what Pay now sends. */
export async function invoiceForPayer(invoice: Invoice) {
  const [business] = await db()<Business[]>`select * from businesses where id = ${invoice.business_id}`;
  const settlesTo = (await getWallets(invoice.business_id)).find((w) => w.network === "bep20")?.address ?? null;
  const rate = await ngnPerUsd();
  const kobo = toKobo(invoice.total_ngn) ?? 0;
  return {
    invoice,
    business: { name: business.business_name, owner: business.owner_name, slug: business.slug },
    settles_to: settlesTo,
    ngn_per_usd: rate,
    usdt_due: ngnToUsdt(kobo, rate),
  };
}
