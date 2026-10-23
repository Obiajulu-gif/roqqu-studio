import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { balances, cleanOnboarding, createBusiness, setupWallets } from "./business";
import { clearRasCache } from "./ras";
import {
  buyProduct,
  createInvoice,
  createProduct,
  decodePhoto,
  ensureFreshLink,
  getInvoice,
  invoiceForPayer,
  listProducts,
  productPhoto,
  setProductActive,
} from "./store";
import { startTestDb } from "./testing";
import { handleRasEvent } from "./webhooks";

let testDb: Awaited<ReturnType<typeof startTestDb>>;
const ORIGIN = "https://studio.test";
// 1x1 transparent PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeAll(async () => {
  process.env.RAS_MODE = "practice";
  process.env.ROQQU_NGN_PER_USD = "1500";
  // Offline: Roqqu market data is unreachable, so the configured rate is used.
  vi.stubGlobal("fetch", async () => { throw new Error("offline in tests"); });
  testDb = await startTestDb();
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await testDb?.stop();
});

beforeEach(async () => {
  clearRasCache();
  await testDb.sql`truncate businesses, webhook_events cascade`;
});

async function shop() {
  return setupWallets(await createBusiness(cleanOnboarding({ owner_name: "Ada Obi", business_name: "Ada Kitchen", email: "ada@example.com" })));
}

describe("products", () => {
  it("stores a product with its photo and hides inactive ones from the store", async () => {
    const b = await shop();
    const p = await createProduct(b.id, { name: "Jollof tray", price_ngn: "12,500", description: "Serves 10", photo: PNG });
    expect(p).toMatchObject({ name: "Jollof tray", price_ngn: "12500.00", has_photo: true, active: true });
    expect((await productPhoto(p.id))?.photo_type).toBe("image/png");
    await setProductActive(b.id, p.id, false);
    expect(await listProducts(b.id, true)).toEqual([]);
    expect(await listProducts(b.id)).toHaveLength(1);
  });

  it("rejects bad prices and photos", async () => {
    const b = await shop();
    await expect(createProduct(b.id, { name: "Zobo", price_ngn: "50" })).rejects.toThrow(/at least ₦100/);
    expect(() => decodePhoto("data:image/gif;base64,R0lG")).toThrow(/JPG, PNG or WebP/);
    expect(() => decodePhoto(`data:image/png;base64,${"A".repeat(300_000)}`)).toThrow(/under 200 KB/);
  });
});

describe("invoices", () => {
  it("numbers invoices, totals items exactly and attaches a payment link", async () => {
    const b = await shop();
    const inv = await createInvoice(b, {
      customer_name: "Bayo Ade", customer_email: "BAYO@example.com",
      items: [{ description: "Logo", quantity: 1, unit_ngn: "100000" }, { description: "Cards", quantity: 3, unit_ngn: "16,666.67" }],
    }, ORIGIN);
    expect(inv.number).toBe("INV-0001");
    expect(inv.total_ngn).toBe("150000.01");
    expect(inv.customer_email).toBe("bayo@example.com");
    expect(inv.reference).toMatch(/^[A-Za-z0-9]{1,20}$/);
    expect(inv.link_wallets.map((w) => w.network)).toEqual(["bep20", "trc20", "bitcoin"]);
    const second = await createInvoice(b, { customer_name: "Bayo Ade", customer_email: "b@x.co", items: [{ description: "x", quantity: 1, unit_ngn: "500" }] }, ORIGIN);
    expect(second.number).toBe("INV-0002");

    const payer = await invoiceForPayer(inv);
    expect(payer.business).toEqual({ name: "Ada Kitchen", owner: "Ada Obi", slug: b.slug });
    expect(payer.settles_to).toMatch(/^0x/);
    expect(payer.usdt_due).toBe("100.01"); // 150,000.01 / 1,500, rounded up
  });

  it("a store purchase becomes an invoice for that product", async () => {
    const b = await shop();
    const p = await createProduct(b.id, { name: "Zobo, 5 litres", price_ngn: "4000" });
    const inv = await buyProduct(b, { product_id: p.id, quantity: 2, customer_name: "Chika Eze", customer_email: "chika@example.com" }, ORIGIN);
    expect(inv.product_id).toBe(p.id);
    expect(inv.items).toEqual([{ description: "Zobo, 5 litres", quantity: 2, unit_ngn: "4000.00" }]);
    expect(inv.total_ngn).toBe("8000.00");
  });

  it("Roqqu's payment-link webhook marks it paid and credits the seller once", async () => {
    const b = await shop();
    const inv = await createInvoice(b, { customer_name: "Bayo Ade", customer_email: "b@x.co", items: [{ description: "Logo", quantity: 1, unit_ngn: "15000" }] }, ORIGIN);
    const event = {
      event_id: "pl1", event_type: "payment_link_completed",
      meta_data: { payment_reference: inv.reference, amount_received: "10", token: "USDT", network: "bep20", hash: "0xabc", status: "completed" },
    };
    expect(await handleRasEvent(event)).toEqual({ handled: true, effect: "invoice paid" });
    expect(await handleRasEvent(event)).toEqual({ handled: false, reason: "duplicate" });
    const paid = await getInvoice(inv.id);
    expect(paid).toMatchObject({ status: "paid", paid_token: "usdt", paid_amount: "10.0000000000" });
    expect((await balances(b.id)).usdt).toBe("10.0000000000");
  });

  it("an underpayment is recorded and still credited", async () => {
    const b = await shop();
    const inv = await createInvoice(b, { customer_name: "Bayo Ade", customer_email: "b@x.co", items: [{ description: "Logo", quantity: 1, unit_ngn: "15000" }] }, ORIGIN);
    await handleRasEvent({ event_id: "pl2", event_type: "payment_link_failed", meta_data: { payment_reference: inv.reference, amount_received: "4", token: "USDT" } });
    expect((await getInvoice(inv.id))?.status).toBe("underpaid");
    expect((await balances(b.id)).usdt).toBe("4.0000000000");
  });

  it("an expired link is replaced when the invoice is opened", async () => {
    const b = await shop();
    const inv = await createInvoice(b, { customer_name: "Bayo Ade", customer_email: "b@x.co", items: [{ description: "Logo", quantity: 1, unit_ngn: "15000" }] }, ORIGIN);
    await testDb.sql`update invoices set link_expires_at = now() - interval '1 minute' where id = ${inv.id}`;
    const fresh = await ensureFreshLink((await getInvoice(inv.id))!, ORIGIN);
    expect(fresh.reference).not.toBe(inv.reference);
    expect(new Date(fresh.link_expires_at!).getTime()).toBeGreaterThan(Date.now());
    expect(await getInvoice("not-a-uuid")).toBeNull();
  });
});
