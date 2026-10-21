/**
 * "Get paid" tools: sell online, invoices, savings group. Each one owns a
 * generated payment product (template workflow + artifact) that it creates on
 * first use and remembers in this browser.
 */
"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AjoPanel, type AjoPanelHandle } from "@/components/AjoPanel";
import { createFromTemplate, generateArtifact } from "@/lib/api";
import { ApiError, getJson, postJson, putJson } from "@/lib/http";

interface Order {
  reference: string;
  product: string;
  amount: string;
  status: "pending" | "verified" | "rejected";
  note: string;
  customer: string;
  description: string;
  kind: string;
  created_at: string;
}

interface Totals {
  money_in: string;
  orders_total: number;
  verified: number;
  needs_attention: number;
}

const naira = (v: string | number) => `₦${Number(v).toLocaleString("en-NG")}`;

function errorText(err: unknown) {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

function publicUrl(path: string) {
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}

/** The template's artifact for this browser; created on demand. */
function useArtifact(template: string) {
  const key = `rq.artifact.${template}`;
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(key);
    } catch {
      saved = null;
    }
    if (!saved) {
      setChecking(false);
      return;
    }
    // The API keeps artifacts in memory; a restart forgets them.
    getJson(`/preview/${saved}/catalog`)
      .then(() => alive && setArtifactId(saved))
      .catch(() => {
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* storage blocked */
        }
      })
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [key]);

  const create = useCallback(
    async (config: Record<string, unknown>) => {
      const wf = await createFromTemplate(template);
      const art = await generateArtifact(wf.workflow.id, config);
      try {
        window.localStorage.setItem(key, art.artifact_id);
      } catch {
        /* storage blocked: works for this visit only */
      }
      setArtifactId(art.artifact_id);
      return art.artifact_id;
    },
    [key, template],
  );

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setArtifactId(null);
  }, [key]);

  return { artifactId, checking, create, reset };
}

function StatusPill({ status }: { status: Order["status"] }) {
  const label = status === "verified" ? "Paid" : status === "rejected" ? "Not paid" : "Waiting";
  return <span className={`gp-pill is-${status}`}>{label}</span>;
}

function SetupCard({
  title,
  lead,
  busy,
  error,
  onSubmit,
  children,
  cta,
}: {
  title: string;
  lead: string;
  busy: boolean;
  error: string | null;
  onSubmit: (e: FormEvent) => void;
  children: React.ReactNode;
  cta: string;
}) {
  return (
    <form className="gp-setup" onSubmit={onSubmit}>
      <h2>{title}</h2>
      <p>{lead}</p>
      {children}
      <button className="svc-btn svc-btn--primary" disabled={busy}>{busy ? "Setting up…" : cta}</button>
      {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
    </form>
  );
}

function ShareBox({ url, label, qr }: { url: string; label: string; qr?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gp-share">
      {qr ? <Image src={qr} alt="QR code for the link" width={112} height={112} unoptimized /> : null}
      <div>
        <p className="gp-share__label">{label}</p>
        <code>{url.replace(/^https?:\/\//, "")}</code>
        <div className="svc-row">
          <a className="svc-btn" href={url} target="_blank" rel="noopener noreferrer">Open</a>
          <button
            type="button"
            className="svc-btn"
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1400);
              })
            }
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a className="svc-btn svc-btn--primary" target="_blank" rel="noopener noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(`Pay securely here: ${url}`)}`}>
            Share on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

function OrdersTable({ orders, onCheck, busy }: { orders: Order[]; onCheck: (ref: string) => void; busy: boolean }) {
  if (orders.length === 0) {
    return <p className="svc-empty">No orders yet. Share your link; orders appear here as buyers check out.</p>;
  }
  return (
    <table className="gp-table">
      <thead>
        <tr><th>Reference</th><th>For</th><th>Amount</th><th>Status</th><th aria-label="Actions" /></tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.reference}>
            <td><code>{o.reference}</code></td>
            <td>{o.customer || o.description || o.product}</td>
            <td>{naira(o.amount)}</td>
            <td><StatusPill status={o.status} /></td>
            <td>
              {o.status !== "verified" ? (
                <button type="button" className="svc-link" disabled={busy} onClick={() => onCheck(o.reference)}>
                  Check payment
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* --- Sell online -------------------------------------------------------------- */

export function SellPage() {
  const { artifactId, checking, create, reset } = useArtifact("sell-online");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [business, setBusiness] = useState("");
  const [items, setItems] = useState([{ name: "", price_ngn: "" }]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);

  const load = useCallback(async () => {
    if (!artifactId) return;
    const [o, t, c] = await Promise.all([
      getJson<Order[]>(`/preview/${artifactId}/orders`),
      getJson<Totals>(`/preview/${artifactId}/totals`),
      getJson<{ name: string; price_ngn: string }[]>(`/preview/${artifactId}/catalog`),
    ]);
    setOrders(o);
    setTotals(t);
    if (c.length) setItems(c.map((x) => ({ name: x.name, price_ngn: String(x.price_ngn) })));
  }, [artifactId]);

  useEffect(() => {
    void load().catch(() => undefined);
    const t = window.setInterval(() => void load().catch(() => undefined), 15000);
    return () => window.clearInterval(t);
  }, [load]);

  const cleanItems = items
    .filter((i) => i.name.trim() && Number(i.price_ngn) > 0)
    .map((i) => ({ name: i.name.trim(), price_ngn: Number(i.price_ngn) }));

  async function setup(e: FormEvent) {
    e.preventDefault();
    if (cleanItems.length === 0) {
      setError("Add at least one item with a price.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = await create({
        business_name: business || "My Shop",
        product_name: cleanItems[0].name,
        price_ngn: Math.max(100, Math.round(cleanItems[0].price_ngn)),
      });
      await putJson(`/preview/${id}/catalog`, { items: cleanItems });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveItems() {
    if (!artifactId) return;
    setBusy(true);
    setError(null);
    try {
      await putJson(`/preview/${artifactId}/catalog`, { items: cleanItems });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function check(ref: string) {
    if (!artifactId) return;
    setBusy(true);
    try {
      await postJson(`/preview/${artifactId}/orders/${ref}/verify`);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const itemEditor = (
    <div className="gp-items">
      {items.map((it, i) => (
        <div key={i} className="gp-items__row">
          <input aria-label={`Item ${i + 1} name`} placeholder="Item name, e.g. Jollof rice tray" value={it.name}
            onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input aria-label={`Item ${i + 1} price`} placeholder="Price ₦" inputMode="numeric" value={it.price_ngn}
            onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, price_ngn: e.target.value } : x)))} />
          <button type="button" className="svc-link" aria-label={`Remove item ${i + 1}`}
            onClick={() => setItems((xs) => (xs.length > 1 ? xs.filter((_, j) => j !== i) : xs))}>✕</button>
        </div>
      ))}
      <button type="button" className="svc-btn" onClick={() => setItems((xs) => [...xs, { name: "", price_ngn: "" }])}>
        Add item
      </button>
    </div>
  );

  if (checking) return <p className="svc-empty">Loading your shop…</p>;
  if (!artifactId) {
    return (
      <SetupCard title="Open your shop" lead="Name it and list what you sell. You get a link to share; buyers pay in crypto to a Roqqu address."
        busy={busy} error={error} onSubmit={(e) => void setup(e)} cta="Create my shop link">
        <label className="svc-field"><span>Business name</span>
          <input value={business} placeholder="Mama Nkechi Foods" onChange={(e) => setBusiness(e.target.value)} />
        </label>
        {itemEditor}
      </SetupCard>
    );
  }

  const shop = publicUrl(`/preview/${artifactId}/shop`);
  return (
    <div className="gp">
      <div className="gp-stats">
        <div><span>Confirmed by Roqqu</span><b>{naira(totals?.money_in ?? 0)}</b></div>
        <div><span>Orders</span><b>{totals?.orders_total ?? 0}</b></div>
        <div><span>Paid</span><b>{totals?.verified ?? 0}</b></div>
        <div><span>Waiting</span><b>{totals?.needs_attention ?? 0}</b></div>
      </div>
      <ShareBox url={shop} label="Your shop link" qr={`/preview/${artifactId}/shop/qr.svg`} />
      <section className="svc-card">
        <h3>Orders</h3>
        <OrdersTable orders={orders} busy={busy} onCheck={(r) => void check(r)} />
      </section>
      <section className="svc-card">
        <h3>What you sell</h3>
        {itemEditor}
        <div className="svc-row">
          <button type="button" className="svc-btn svc-btn--primary" disabled={busy} onClick={() => void saveItems()}>Save items</button>
          <button type="button" className="svc-link" onClick={reset}>Start a new shop</button>
        </div>
      </section>
      {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
    </div>
  );
}

/* --- Invoices ---------------------------------------------------------------- */

export function InvoicesPage() {
  const { artifactId, checking, create, reset } = useArtifact("invoice");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [business, setBusiness] = useState("");
  const [form, setForm] = useState({ customer: "", description: "", amount: "" });
  const [invoices, setInvoices] = useState<Order[]>([]);

  const load = useCallback(async () => {
    if (!artifactId) return;
    setInvoices(await getJson<Order[]>(`/preview/${artifactId}/invoices`));
  }, [artifactId]);

  useEffect(() => {
    void load().catch(() => undefined);
    const t = window.setInterval(() => void load().catch(() => undefined), 15000);
    return () => window.clearInterval(t);
  }, [load]);

  async function setup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create({ business_name: business || "My Business" });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!artifactId) return;
    setBusy(true);
    setError(null);
    try {
      await postJson(`/preview/${artifactId}/invoices`, { ...form, amount: Number(form.amount) });
      setForm({ customer: "", description: "", amount: "" });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function check(ref: string) {
    if (!artifactId) return;
    setBusy(true);
    try {
      await postJson(`/preview/${artifactId}/orders/${ref}/verify`);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <p className="svc-empty">Loading your invoices…</p>;
  if (!artifactId) {
    return (
      <SetupCard title="Set up invoicing" lead="Your business name goes on every invoice. Clients pay the naira total in crypto at Roqqu's live price."
        busy={busy} error={error} onSubmit={(e) => void setup(e)} cta="Start invoicing">
        <label className="svc-field"><span>Business name</span>
          <input value={business} placeholder="Ada Designs" onChange={(e) => setBusiness(e.target.value)} />
        </label>
      </SetupCard>
    );
  }

  const paid = invoices.filter((i) => i.status === "verified");
  return (
    <div className="gp">
      <div className="gp-stats">
        <div><span>Invoices</span><b>{invoices.length}</b></div>
        <div><span>Paid</span><b>{paid.length}</b></div>
        <div><span>Collected</span><b>{naira(paid.reduce((s, i) => s + Number(i.amount), 0))}</b></div>
      </div>
      <form className="svc-card" onSubmit={(e) => void send(e)}>
        <h3>New invoice</h3>
        <div className="svc-grid">
          <label className="svc-field"><span>Client name</span>
            <input value={form.customer} required onChange={(e) => setForm({ ...form, customer: e.target.value })} />
          </label>
          <label className="svc-field"><span>What it is for</span>
            <input value={form.description} required placeholder="Logo design" onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="svc-field"><span>Amount (₦)</span>
            <input value={form.amount} required inputMode="numeric" onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <small>Minimum ₦100</small>
          </label>
        </div>
        <button className="svc-btn svc-btn--primary" disabled={busy}>Create invoice</button>
      </form>
      <section className="svc-card">
        <h3>Your invoices</h3>
        {invoices.length === 0 ? (
          <p className="svc-empty">No invoices yet. Create one above and share its link.</p>
        ) : (
          <table className="gp-table">
            <thead><tr><th>Client</th><th>For</th><th>Amount</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {invoices.map((inv) => {
                const link = publicUrl(`/preview/${artifactId}/invoice/${inv.reference}`);
                return (
                  <tr key={inv.reference}>
                    <td>{inv.customer}</td>
                    <td>{inv.description}</td>
                    <td>{naira(inv.amount)}</td>
                    <td><StatusPill status={inv.status} /></td>
                    <td className="gp-actions">
                      <a className="svc-link" href={link} target="_blank" rel="noopener noreferrer">Open</a>
                      <button type="button" className="svc-link" onClick={() => void navigator.clipboard.writeText(link)}>Copy link</button>
                      {inv.status !== "verified" ? (
                        <button type="button" className="svc-link" disabled={busy} onClick={() => void check(inv.reference)}>Check payment</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button type="button" className="svc-link" onClick={reset}>Start over with a new business</button>
      </section>
      {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
    </div>
  );
}

/* --- Savings group ------------------------------------------------------------ */

export function SavingsPage() {
  const { artifactId, checking, create, reset } = useArtifact("ajo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ business_name: "", price_ngn: "10000" });
  const panel = useRef<AjoPanelHandle>(null);

  async function setup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create({
        business_name: form.business_name || "Our Ajo",
        product_name: "Contribution",
        price_ngn: Math.max(100, Number(form.price_ngn) || 10000),
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <p className="svc-empty">Loading your group…</p>;
  if (!artifactId) {
    return (
      <SetupCard title="Start a savings group" lead="Members contribute the same amount each round; the pot goes to one member per round. Every contribution is checked on Roqqu."
        busy={busy} error={error} onSubmit={(e) => void setup(e)} cta="Create the group">
        <div className="svc-grid">
          <label className="svc-field"><span>Group name</span>
            <input value={form.business_name} placeholder="Market Women Ajo" onChange={(e) => setForm({ ...form, business_name: e.target.value })} />
          </label>
          <label className="svc-field"><span>Contribution per round (₦)</span>
            <input value={form.price_ngn} inputMode="numeric" onChange={(e) => setForm({ ...form, price_ngn: e.target.value })} />
          </label>
        </div>
      </SetupCard>
    );
  }

  const link = publicUrl(`/preview/${artifactId}/contribute`);
  return (
    <div className="gp">
      <ShareBox url={link} label="Members pay here" />
      <section className="svc-card">
        <div className="svc-row gp-spread">
          <h3>Members and rounds</h3>
          <button type="button" className="svc-btn" onClick={() => panel.current?.addMember()}>Add member</button>
        </div>
        <AjoPanel ref={panel} artifactId={artifactId} />
        <button type="button" className="svc-link" onClick={reset}>Start a new group</button>
      </section>
      {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
    </div>
  );
}
