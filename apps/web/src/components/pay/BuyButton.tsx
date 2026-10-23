/**
 * "Buy" on a store product: the two details Roqqu needs for the payment link
 * (name and email for the receipt), then straight to the pay page.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function BuyButton({ slug, productId, productName }: { slug: string; productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_name: "", customer_email: "", quantity: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/store/${slug}/buy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_id: productId, ...form, quantity: Number(form.quantity) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start the payment");
      router.push(json.pay_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the payment");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="pp-btn" onClick={() => setOpen(true)}>
        Buy
      </button>
    );
  }
  return (
    <form className="st-buy" onSubmit={submit} aria-label={`Buy ${productName}`}>
      <label>
        <span>Your name</span>
        <input autoComplete="name" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} required autoFocus />
      </label>
      <label>
        <span>Email for the receipt</span>
        <input type="email" autoComplete="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} required />
      </label>
      <label>
        <span>Quantity</span>
        <input type="number" min={1} max={100} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      </label>
      <button className="pp-btn" disabled={busy}>{busy ? "Preparing payment…" : "Continue to payment"}</button>
      {error ? <p className="pp-err" role="alert">{error}</p> : null}
    </form>
  );
}
