/**
 * What a decrypted RAS event does to business data. Every event is recorded
 * by event_id first, so a retried webhook is a no-op, and every ledger row is
 * unique per (business, kind, ref), so money is never counted twice.
 */
import { db } from "./db";
import type { RasEvent } from "./webhookCrypto";

export type Outcome =
  | { handled: false; reason: "duplicate" | "not_ours" | "unknown_event" }
  | { handled: true; effect: string };

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const tokenOf = (v: unknown) => str(v).toLowerCase();

export async function handleRasEvent(event: RasEvent): Promise<Outcome> {
  const sql = db();
  const meta = event.meta_data ?? {};
  const fresh = await sql`
    insert into webhook_events (event_id, event_type, payload) values (${str(event.event_id)}, ${event.event_type}, ${sql.json(JSON.parse(JSON.stringify(event)))})
    on conflict do nothing returning event_id`;
  if (fresh.length === 0) return { handled: false, reason: "duplicate" };

  switch (event.event_type) {
    case "payment_link_completed":
    case "payment_link_completed_overpaid":
    case "payment_link_failed": {
      const reference = str(meta.payment_reference);
      const [invoice] = await sql<{ id: string; business_id: string }[]>`
        select id, business_id from invoices where reference = ${reference}`;
      if (!invoice) return { handled: false, reason: "not_ours" };
      const status =
        event.event_type === "payment_link_failed" ? "underpaid"
        : event.event_type === "payment_link_completed_overpaid" ? "overpaid"
        : "paid";
      const token = tokenOf(meta.token);
      const received = str(meta.amount_received || meta.value || "0");
      await sql.begin(async (tx) => {
        await tx`update invoices set status = ${status}, paid_token = ${token}, paid_amount = ${received},
                   paid_hash = ${str(meta.hash)}, paid_at = now()
                 where id = ${invoice.id} and status in ('open', 'underpaid')`;
        if (Number(received) > 0) {
          await tx`insert into ledger (business_id, token, amount, kind, ref)
                   values (${invoice.business_id}, ${token}, ${received}, 'payment', ${invoice.id})
                   on conflict do nothing`;
        }
      });
      return { handled: true, effect: `invoice ${status}` };
    }
    case "token_received": {
      const [wallet] = await sql<{ business_id: string; token: string }[]>`
        select business_id, token from wallets where lower(address) = lower(${str(meta.address)})`;
      if (!wallet) return { handled: false, reason: "not_ours" };
      const value = str(meta.value);
      if (!(Number(value) > 0)) return { handled: true, effect: "zero deposit ignored" };
      await sql`insert into ledger (business_id, token, amount, kind, ref)
                values (${wallet.business_id}, ${tokenOf(meta.token) || wallet.token}, ${value}, 'deposit', ${str(meta.hash) || str(event.event_id)})
                on conflict do nothing`;
      return { handled: true, effect: "deposit credited" };
    }
    case "token_sent": {
      const rows = await sql`update sends set status = 'sent' where refid = ${str(meta.reference)} and status = 'queued' returning id`;
      return rows.length ? { handled: true, effect: "send confirmed" } : { handled: false, reason: "not_ours" };
    }
    case "token_refunded": {
      const [send] = await sql<{ id: string; business_id: string; token: string; amount: string }[]>`
        update sends set status = 'refunded' where refid = ${str(meta.refid)} and status in ('queued', 'sent')
        returning id, business_id, token, amount::text`;
      if (!send) return { handled: false, reason: "not_ours" };
      await sql`insert into ledger (business_id, token, amount, kind, ref)
                values (${send.business_id}, ${send.token}, ${send.amount}, 'refund', ${send.id})
                on conflict do nothing`;
      return { handled: true, effect: "send refunded" };
    }
    default:
      return { handled: false, reason: "unknown_event" };
  }
}
