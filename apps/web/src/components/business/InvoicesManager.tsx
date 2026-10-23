/**
 * Invoices: bill a customer in naira with line items. Each invoice gets its
 * own Roqqu payment link and a pay page showing the business name, the
 * owner's name and the wallet it settles to.
 */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useMe } from "./useBusiness";

interface Item {
  description: string;
  quantity: string;
  unit_ngn: string;
}

interface Invoice {
  id: string;
  number: string;
  customer_name: string;
  total_ngn: string;
  status: "open" | "paid" | "overpaid" | "underpaid" | "void";
  paid_amount: string | null;
  paid_token: string | null;
  created_at: string;
}

const naira = (v: string | number) => `₦${Number(v).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const STATUS: Record<Invoice["status"], string> = {
  open: "Waiting for payment",
  paid: "Paid",
  overpaid: "Paid (overpaid)",
  underpaid: "Underpaid",
  void: "Cancelled",
};
const EMPTY_ITEM: Item = { description: "", quantity: "1", unit_ngn: "" };

export function InvoicesManager() {
  const me = useMe();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customer, setCustomer] = useState({ customer_name: "", customer_email: "" });
  const [items, setItems] = useState<Item[]>([{ ...EMPTY_ITEM }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/biz/invoices", { cache: "no-store" });
    if (res.ok) setInvoices((await res.json()).invoices);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 10_000); // payments land by webhook
    return () => window.clearInterval(t);
  }, [load]);

  const total = items.reduce((s, it) => s + (Number(it.unit_ngn.replace(/,/g, "")) || 0) * (Number(it.quantity) || 0), 0);
  const update = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/biz/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...customer, items: items.map((it) => ({ ...it, quantity: Number(it.quantity) })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the invoice");
      setCreated(json.pay_url);
      setCustomer({ customer_name: "", customer_email: "" });
      setItems([{ ...EMPTY_ITEM }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="im">
      <form className="svc-card" onSubmit={create}>
        <h3>New invoice from {me.business.business_name}</h3>
        <div className="svc-grid">
          <label className="svc-field">
            <span>Customer name</span>
            <input value={customer.customer_name} onChange={(e) => setCustomer({ ...customer, customer_name: e.target.value })} required />
          </label>
          <label className="svc-field">
            <span>Customer email</span>
            <input type="email" value={customer.customer_email} onChange={(e) => setCustomer({ ...customer, customer_email: e.target.value })} required />
          </label>
        </div>
        <table className="svc-table im-items">
          <thead>
            <tr><th>Item</th><th>Qty</th><th>Price (₦)</th><th aria-label="Remove" /></tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td><input aria-label="Item" value={it.description} onChange={(e) => update(i, { description: e.target.value })} required /></td>
                <td><input aria-label="Quantity" inputMode="numeric" value={it.quantity} onChange={(e) => update(i, { quantity: e.target.value.replace(/\D/g, "") })} required /></td>
                <td><input aria-label="Price" inputMode="decimal" value={it.unit_ngn} onChange={(e) => update(i, { unit_ngn: e.target.value })} required /></td>
                <td>
                  <button type="button" className="svc-link" aria-label={`Remove item ${i + 1}`}
                    onClick={() => setItems((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : list))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="svc-row im-foot">
          <button type="button" className="svc-btn" onClick={() => setItems((list) => [...list, { ...EMPTY_ITEM }])}>Add item</button>
          <span className="im-total">Total <b>{naira(total)}</b></span>
          <button className="svc-btn svc-btn--primary" disabled={busy || total <= 0}>{busy ? "Creating…" : "Create invoice"}</button>
        </div>
        {created ? (
          <div className="svc-notice is-ok" role="status">
            Invoice ready. Share this link: <a href={created} target="_blank" rel="noopener noreferrer">{created}</a>
          </div>
        ) : null}
        {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
      </form>

      {invoices.length === 0 ? (
        <p className="svc-empty">No invoices yet.</p>
      ) : (
        <ul className="im-list">
          {invoices.map((inv) => (
            <li key={inv.id}>
              <div>
                <b>{inv.number}</b>
                <span>{inv.customer_name} · {new Date(inv.created_at).toLocaleDateString()}</span>
              </div>
              <b className="im-amt">{naira(inv.total_ngn)}</b>
              <span className={`im-status is-${inv.status}`}>
                {STATUS[inv.status]}
                {inv.paid_amount && inv.status !== "open" ? ` · ${Number(inv.paid_amount)} ${inv.paid_token?.toUpperCase() ?? ""}` : ""}
              </span>
              <a className="svc-link" href={`/pay/${inv.id}`} target="_blank" rel="noopener noreferrer">Open</a>
              <button type="button" className="svc-link" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/pay/${inv.id}`)}>Copy link</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
