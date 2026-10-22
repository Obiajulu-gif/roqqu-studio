import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { balances, cleanOnboarding, consumeLoginToken, createBusiness, createLoginToken, getWallets, setupWallets } from "./business";
import { decimalGte, ngnToUsdt, paymentReference, slugify, toKobo } from "./money";
import { confirmSend, startSend } from "./sends";
import { startTestDb } from "./testing";
import { decryptWebhook, encryptWebhook } from "./webhookCrypto";
import { handleRasEvent } from "./webhooks";

let testDb: Awaited<ReturnType<typeof startTestDb>>;

beforeAll(async () => {
  delete process.env.RAS_TEST_KEY;
  delete process.env.RAS_LIVE_KEY;
  process.env.RAS_MODE = "practice";
  testDb = await startTestDb();
}, 60_000);

afterAll(async () => {
  await testDb?.stop();
});

beforeEach(async () => {
  await testDb.sql`truncate businesses, webhook_events cascade`;
});

async function readyBusiness(email = "ada@example.com") {
  const b = await createBusiness(cleanOnboarding({ owner_name: "Ada Obi", business_name: "Ada's Kitchen", email }));
  return setupWallets(b);
}

describe("money helpers", () => {
  it("parses naira to kobo and prices USDT rounded up", () => {
    expect(toKobo("1,500.5")).toBe(150050);
    expect(toKobo("0")).toBeNull();
    expect(toKobo("12.345")).toBeNull();
    expect(ngnToUsdt(13_580_000, 1358)).toBe("100.00");
    expect(ngnToUsdt(13_580_001, 1358)).toBe("100.01");
    expect(paymentReference("INV", "ab-12_cd")).toBe("INVab12cd");
    expect(slugify("Ada's Kitchen & Co.")).toBe("ada-s-kitchen-co");
    expect(decimalGte("10.5", "10.50")).toBe(true);
    expect(decimalGte("0.1", "0.1000001")).toBe(false);
  });
});

describe("webhook crypto", () => {
  it("round-trips and rejects other keys", () => {
    const key = "ras_test_0123456789abcdef0123456789";
    const event = { event_id: "1", event_type: "token_received", meta_data: { value: 2 } };
    const { body, iv } = encryptWebhook(event, key);
    expect(decryptWebhook(body.hash, iv, key)).toEqual(event);
    expect(decryptWebhook(body.hash, iv, "someone_else_0123456789abcdef0123")).toBeNull();
  });
});

describe("onboarding", () => {
  it("validates the three fields", () => {
    expect(() => cleanOnboarding({ owner_name: "A", business_name: "Shop", email: "a@b.co" })).toThrow(/your name/);
    expect(() => cleanOnboarding({ owner_name: "Ada", business_name: "Shop", email: "nope" })).toThrow(/valid email/);
    expect(cleanOnboarding({ owner_name: " Ada  Obi ", business_name: "Shop", email: "ADA@B.CO" })).toEqual({
      owner_name: "Ada Obi", business_name: "Shop", email: "ada@b.co",
    });
  });

  it("creates the business with a wallet on every network", async () => {
    const b = await readyBusiness();
    expect(b.wallet_status).toBe("ready");
    expect(b.slug).toBe("ada-s-kitchen");
    const wallets = await getWallets(b.id);
    expect(wallets.map((w) => w.network)).toEqual(["bep20", "bitcoin", "trc20"]);
    expect(wallets.find((w) => w.network === "bep20")!.address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it("refuses a second business on the same email", async () => {
    await readyBusiness();
    await expect(readyBusiness()).rejects.toThrow(/already has a business/);
  });

  it("sign-in links work once", async () => {
    const b = await readyBusiness();
    const link = await createLoginToken("ADA@example.com");
    expect(link?.business.id).toBe(b.id);
    expect(await consumeLoginToken(link!.raw)).toBe(b.id);
    expect(await consumeLoginToken(link!.raw)).toBeNull();
    expect(await createLoginToken("nobody@example.com")).toBeNull();
  });
});

describe("webhooks and the ledger", () => {
  it("credits a deposit once, however often RAS retries", async () => {
    const b = await readyBusiness();
    const bep = (await getWallets(b.id)).find((w) => w.network === "bep20")!;
    const event = {
      event_id: "e1", event_type: "token_received",
      meta_data: { address: bep.address.toUpperCase().replace("0X", "0x"), network: "bep20", token: "usdt", value: 25, hash: "0xh1" },
    };
    expect(await handleRasEvent(event)).toEqual({ handled: true, effect: "deposit credited" });
    expect(await handleRasEvent(event)).toEqual({ handled: false, reason: "duplicate" });
    expect(await handleRasEvent({ ...event, event_id: "e1-again" })).toEqual({ handled: true, effect: "deposit credited" });
    expect((await balances(b.id)).usdt).toBe("25.0000000000");
  });

  it("ignores deposits to addresses that are not ours", async () => {
    await readyBusiness();
    const out = await handleRasEvent({ event_id: "x", event_type: "token_received", meta_data: { address: "0xnope", value: 5 } });
    expect(out).toEqual({ handled: false, reason: "not_ours" });
  });
});

describe("sending crypto out", () => {
  const TRON = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";

  async function funded() {
    const b = await readyBusiness();
    await testDb.sql`insert into ledger (business_id, token, amount, kind, ref) values (${b.id}, 'usdt', 50, 'deposit', 'seed')`;
    return b;
  }

  it("checks the network, the balance and the code, then debits once", async () => {
    const b = await funded();
    await expect(startSend(b.id, { network: "bep20", to: TRON, amount: "5" })).rejects.toThrow(/on TRC20, not BEP20/);
    await expect(startSend(b.id, { network: "trc20", to: TRON, amount: "60" })).rejects.toThrow(/Not enough USDT/);

    const { send, code } = await startSend(b.id, { network: "trc20", to: TRON, amount: "10" });
    expect(send.status).toBe("awaiting_code");
    const wrong = code === "000000" ? "111111" : "000000";
    await expect(confirmSend(b.id, send.id, wrong)).rejects.toThrow(/Wrong code. 4 tries left/);

    const done = await confirmSend(b.id, send.id, code);
    expect(done.status).toBe("queued");
    expect(done.refid).toMatch(/^\d+$/);
    expect((await balances(b.id)).usdt).toBe("40.0000000000");
    await expect(confirmSend(b.id, send.id, code)).rejects.toThrow(/already confirmed/);

    // RAS confirms on-chain, then (say) refunds: the money comes back exactly once.
    await handleRasEvent({ event_id: "s1", event_type: "token_sent", meta_data: { reference: done.refid } });
    await handleRasEvent({ event_id: "r1", event_type: "token_refunded", meta_data: { refid: done.refid } });
    await handleRasEvent({ event_id: "r2", event_type: "token_refunded", meta_data: { refid: done.refid } });
    expect((await balances(b.id)).usdt).toBe("50.0000000000");
  });

  it("enforces the daily limit", async () => {
    process.env.BIZ_DAILY_SEND_USD = "15";
    try {
      const b = await funded();
      const first = await startSend(b.id, { network: "trc20", to: TRON, amount: "10" });
      await confirmSend(b.id, first.send.id, first.code);
      await expect(startSend(b.id, { network: "trc20", to: TRON, amount: "10" })).rejects.toThrow(/daily send limit of \$15/);
    } finally {
      delete process.env.BIZ_DAILY_SEND_USD;
    }
  });

  it("never lets one send be debited by another business", async () => {
    const a = await funded();
    const other = await readyBusiness("bayo@example.com");
    const { send, code } = await startSend(a.id, { network: "trc20", to: TRON, amount: "1" });
    await expect(confirmSend(other.id, send.id, code)).rejects.toThrow(/not found/);
  });
});
