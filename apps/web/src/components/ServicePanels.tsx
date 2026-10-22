/**
 * Working business panels for the Roqqu templates: withdrawals, price alerts
 * and payroll. Each calls /services/* in practice mode (no keys, RAS-shaped
 * simulated answers) or live mode (the real Roqqu API Service; a test key
 * never moves real money).
 */
"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { ApiError, getJson, http, postJson } from "@/lib/http";

type Mode = "practice" | "live";

const ACTIVITY_EVENT = "rq-service-activity";

interface HistoryEntry {
  id: string;
  at: string;
  panel: string;
  action: string;
  mode: Mode;
  ok: boolean;
  summary: string;
}

interface RunResult<T> {
  mode: Mode;
  data: T;
  entry: HistoryEntry;
}

interface ServiceStatus {
  live_key: boolean;
  mode: "practice" | "test" | "live";
  production_allowed: boolean;
  ngn_per_usd: string;
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

async function runAction<T>(action: string, params: Record<string, unknown>, mode: Mode) {
  return postJson<RunResult<T>>("/services/run", { action, params, mode });
}

/* --- shared pieces -------------------------------------------------------- */

function useStatus() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);
  useEffect(() => {
    getJson<ServiceStatus>("/services/status").then(setStatus).catch(() => setStatus(null));
  }, []);
  return status;
}

function ModeSwitch({
  mode,
  onChange,
  movesMoney,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  movesMoney: boolean;
}) {
  const status = useStatus();
  const realMoney = status?.mode === "live";
  const liveReady = !!status?.live_key && (!movesMoney || !realMoney || status.production_allowed);
  const why = !status?.live_key
    ? "Connecting needs RAS_TEST_KEY on the API."
    : movesMoney && realMoney && !status.production_allowed
      ? "Your live key moves real money. It needs ALLOW_PRODUCTION_EXECUTION=true on the API."
      : "";
  return (
    <div className="svc-mode">
      <div className="svc-mode__seg" role="radiogroup" aria-label="Mode">
        <button type="button" role="radio" aria-checked={mode === "practice"}
          className={mode === "practice" ? "is-on" : ""} onClick={() => onChange("practice")}>
          Practice
        </button>
        <button type="button" role="radio" aria-checked={mode === "live"} disabled={!liveReady}
          className={mode === "live" ? "is-on is-live" : ""} onClick={() => onChange("live")}>
          {status?.mode === "live" ? "Live on Roqqu" : "Roqqu test mode"}
        </button>
      </div>
      <small>{mode === "practice" ? "Simulated with Roqqu's response shapes. No money moves." : realMoney ? "Real Roqqu API, real money." : "Real Roqqu API with your test key. No real money moves."} {why}</small>
    </div>
  );
}

function History({ panel, nonce }: { panel: string; nonce: number }) {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    const q = panel ? `?panel=${panel}` : "";
    getJson<HistoryEntry[]>(`/services/history${q}`).then(setItems).catch(() => setItems([]));
  }, [panel, nonce]);
  if (items.length === 0) return <p className="svc-empty">Nothing yet. What you do here shows up in this list.</p>;
  return (
    <ul className="svc-history">
      {items.slice(0, 8).map((h) => (
        <li key={h.id} className={h.ok ? "is-ok" : "is-bad"}>
          <span aria-hidden>{h.ok ? "✓" : "✕"}</span>
          <p>{h.summary}</p>
          <small>{h.mode === "practice" ? "Practice" : "Live"} · {new Date(h.at).toLocaleTimeString()}</small>
        </li>
      ))}
    </ul>
  );
}

function Panel({
  title,
  lead,
  children,
  panel,
  nonce,
}: {
  title: string;
  lead: string;
  children: ReactNode;
  panel: string;
  nonce: number;
}) {
  return (
    <div className="svc">
      <div className="svc__main">
        <header className="svc__head">
          <h2>{title}</h2>
          <p>{lead}</p>
        </header>
        {children}
      </div>
      <aside className="svc__side" aria-label="Recent activity">
        <h3>Recent</h3>
        <History panel={panel} nonce={nonce} />
      </aside>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="svc-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Notice({ kind, children }: { kind: "ok" | "bad" | "info"; children: ReactNode }) {
  return <div className={`svc-notice is-${kind}`} role={kind === "bad" ? "alert" : "status"}>{children}</div>;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const go = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorText(err));
      return null;
    } finally {
      setBusy(false);
      setNonce((n) => n + 1);
      window.dispatchEvent(new Event(ACTIVITY_EVENT));
    }
  }, []);
  return { busy, error, nonce, go, setError };
}

/** What RAS can pay out on: option id -> [network, coin]. */
const PAY_OPTIONS = {
  usdt_trc20: ["trc20", "usdt"],
  usdt_bep20: ["bep20", "usdt"],
  btc: ["bitcoin", "btc"],
} as const satisfies Record<string, readonly [string, string]>;
type PayOption = keyof typeof PAY_OPTIONS;

function CoinOptions() {
  return (
    <>
      <option value="usdt_trc20">USDT on Tron (TRC20)</option>
      <option value="usdt_bep20">USDT on BNB Chain (BEP20)</option>
      <option value="btc">Bitcoin (BTC)</option>
    </>
  );
}

const naira = (v: string | number) => `₦${Number(v).toLocaleString("en-NG")}`;

/** Every panel action, newest first, for the dashboard's Activity card. */
export function RecentServiceActivity() {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    const load = () => getJson<HistoryEntry[]>("/services/history").then(setItems).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 15000);
    window.addEventListener(ACTIVITY_EVENT, load);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(ACTIVITY_EVENT, load);
    };
  }, []);
  if (items.length === 0) {
    return <p className="biz-activity__empty">No activity yet. Payments, address checks and payouts appear here.</p>;
  }
  return <History panel="" nonce={items.length} />;
}

/* --- withdrawals ------------------------------------------------------------ */

export function WithdrawPanel() {
  const [mode, setMode] = useState<Mode>("practice");
  const { busy, error, nonce, go, setError } = useAction();
  const [form, setForm] = useState<{ option: PayOption; addr: string; amount: string }>({ option: "usdt_trc20", addr: "", amount: "" });
  const [network, coin] = PAY_OPTIONS[form.option];
  const [checked, setChecked] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setChecked(null);
    setSent(null);
    const r = await go(() => runAction<string[]>("check-address", { address: form.addr }, mode));
    if (!r) return;
    if (r.data.includes(network)) setChecked(form.addr);
    else setError(`That address is on ${r.data.join(", ").toUpperCase() || "no network"}, not ${network.toUpperCase()}.`);
  }
  async function send() {
    const r = await go(() => runAction<{ refid: string }>("send-coin", { token: coin, network, amount: form.amount, to: form.addr }, mode));
    if (r) setSent(`${form.amount} ${coin.toUpperCase()} queued to ${form.addr.slice(0, 10)}… (refid ${r.data.refid}). Roqqu confirms on-chain shortly.`);
  }

  return (
    <Panel title="Customer withdrawals" lead="Roqqu checks which network the address is on, then you send. The network fee comes out of the amount sent." panel="withdraw" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <form className="svc-card" onSubmit={check}>
        <div className="svc-grid">
          <Field label="Coin">
            <select value={form.option} onChange={(e) => { setForm({ ...form, option: e.target.value as PayOption }); setChecked(null); }}>
              <CoinOptions />
            </select>
          </Field>
          <Field label="Customer's address">
            <input value={form.addr} placeholder={network === "bep20" ? "0x…" : network === "bitcoin" ? "bc1… or 1… / 3…" : "T…"}
              onChange={(e) => { setForm({ ...form, addr: e.target.value.trim() }); setChecked(null); }} required />
          </Field>
          <Field label={`Amount (${coin.toUpperCase()})`}>
            <input inputMode="decimal" value={form.amount} placeholder="10" onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
        </div>
        <div className="svc-row">
          <button className="svc-btn" disabled={busy}>Check address</button>
          <button type="button" className="svc-btn svc-btn--primary" disabled={busy || checked !== form.addr || !form.amount}
            onClick={() => void send()}>
            Send {form.amount || 0} {coin.toUpperCase()}
          </button>
        </div>
        {checked === form.addr ? <Notice kind="ok">Address checked. You can send.</Notice> : null}
        {sent ? <Notice kind="ok">{sent}</Notice> : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}

/* --- price alerts ------------------------------------------------------------ */

interface Alert {
  id: string;
  symbol: string;
  direction: "above" | "below";
  price_usd: string;
  triggered_at: string | null;
  last_price: string | null;
}

interface AlertBoard {
  source: "live" | "practice";
  prices: Record<string, { price: number; change: number }>;
  alerts: Alert[];
}

export function AlertsPanel() {
  const { busy, error, nonce, go } = useAction();
  const [board, setBoard] = useState<AlertBoard | null>(null);
  const [form, setForm] = useState({ symbol: "btc", direction: "above", price_usd: "" });

  const refresh = useCallback(async () => {
    const b = await go(() => getJson<AlertBoard>("/services/alerts"));
    if (b) setBoard(b);
  }, [go]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const ok = await go(() => postJson("/services/alerts", form));
    if (ok) {
      setForm({ ...form, price_usd: "" });
      await refresh();
    }
  }
  async function remove(id: string) {
    await go(() => http.delete(`/services/alerts/${id}`));
    await refresh();
  }

  const coins = board ? Object.entries(board.prices).slice(0, 8) : [];
  return (
    <Panel title="Crypto price alerts" lead="Prices are re-checked every 30 seconds while this page is open." panel="alerts" nonce={nonce}>
      {board?.source === "practice" ? (
        <Notice kind="info">Roqqu&apos;s price service is unreachable, so these are practice prices, not market data.</Notice>
      ) : null}
      <div className="svc-prices">
        {coins.map(([sym, p]) => (
          <div key={sym}>
            <b>{sym.toUpperCase()}</b>
            <span>${Number(p.price).toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
            <em className={p.change >= 0 ? "up" : "down"}>{p.change >= 0 ? "▲" : "▼"} {Math.abs(Number(p.change)).toFixed(2)}%</em>
          </div>
        ))}
      </div>
      <form className="svc-card" onSubmit={add}>
        <h3>New alert</h3>
        <div className="svc-grid">
          <Field label="Coin">
            <select value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}>
              {coins.map(([sym]) => <option key={sym} value={sym}>{sym.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="When the price is">
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="above">At or above</option>
              <option value="below">At or below</option>
            </select>
          </Field>
          <Field label="Price (USD)">
            <input inputMode="decimal" value={form.price_usd} onChange={(e) => setForm({ ...form, price_usd: e.target.value })} required />
          </Field>
        </div>
        <button className="svc-btn svc-btn--primary" disabled={busy}>Add alert</button>
      </form>
      <ul className="svc-alerts">
        {(board?.alerts ?? []).map((a) => (
          <li key={a.id} className={a.triggered_at ? "is-fired" : ""}>
            <p>
              <b>{a.symbol.toUpperCase()}</b> {a.direction} ${Number(a.price_usd).toLocaleString("en-US")}
              {a.last_price ? <small> · now ${Number(a.last_price).toLocaleString("en-US")}</small> : null}
            </p>
            <span>{a.triggered_at ? `Fired ${new Date(a.triggered_at).toLocaleTimeString()}` : "Watching"}</span>
            <button type="button" className="svc-link" onClick={() => void remove(a.id)}>Remove</button>
          </li>
        ))}
      </ul>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}

/* --- payroll ----------------------------------------------------------------- */

interface PayRow {
  name: string;
  wallet: string;
  amount_ngn: string;
}

interface PayResult {
  name: string;
  ok: boolean;
  amount_token: string;
  message: string;
}

export function PayrollPanel() {
  const [mode, setMode] = useState<Mode>("practice");
  const { busy, error, nonce, go } = useAction();
  const [token, setToken] = useState<PayOption>("usdt_trc20");
  const coinLabel = PAY_OPTIONS[token][1].toUpperCase();
  const [rows, setRows] = useState<PayRow[]>([{ name: "", wallet: "", amount_ngn: "" }]);
  const [results, setResults] = useState<PayResult[] | null>(null);

  const update = (i: number, patch: Partial<PayRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((s, r) => s + (Number(r.amount_ngn) || 0), 0);

  async function pay(e: FormEvent) {
    e.preventDefault();
    setResults(null);
    const filled = rows.filter((r) => r.name && r.wallet && Number(r.amount_ngn) > 0);
    const res = await go(() => postJson<{ results: PayResult[] }>("/services/payroll", { token, mode, rows: filled }));
    if (res) setResults(res.results);
  }

  return (
    <Panel title="Pay staff in crypto" lead="Enter each person's wallet and naira amount. Studio prices it at Roqqu's live NGN rate and skips any address on the wrong network." panel="payroll" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <form className="svc-card" onSubmit={pay}>
        <div className="svc-grid">
          <Field label="Pay in">
            <select value={token} onChange={(e) => setToken(e.target.value as PayOption)}>
              <CoinOptions />
            </select>
          </Field>
        </div>
        <table className="svc-table">
          <thead>
            <tr><th>Name</th><th>{coinLabel} wallet ({PAY_OPTIONS[token][0].toUpperCase()})</th><th>Amount (₦)</th><th aria-label="Remove" /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input aria-label="Name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                <td><input aria-label="Wallet" value={r.wallet} onChange={(e) => update(i, { wallet: e.target.value.trim() })} /></td>
                <td><input aria-label="Amount" inputMode="numeric" value={r.amount_ngn} onChange={(e) => update(i, { amount_ngn: e.target.value })} /></td>
                <td>
                  <button type="button" className="svc-link" aria-label={`Remove row ${i + 1}`}
                    onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs))}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="svc-row">
          <button type="button" className="svc-btn" onClick={() => setRows((rs) => [...rs, { name: "", wallet: "", amount_ngn: "" }])}>
            Add person
          </button>
          <button className="svc-btn svc-btn--primary" disabled={busy || total <= 0}>Pay {naira(total)}</button>
        </div>
        {results ? (
          <ul className="svc-results">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? "is-ok" : "is-bad"}>
                <b>{r.name}</b> <code>{r.amount_token} {coinLabel}</code> {r.message}
              </li>
            ))}
          </ul>
        ) : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}
