/**
 * Working business panels for the Roqqu templates: bills, data, withdrawals,
 * KYC, price alerts and payroll. Each calls /services/* in practice mode (no
 * keys, Roqqu-shaped simulated answers) or live mode (the real Roqqu API).
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
  const liveReady = !!status?.live_key && (!movesMoney || status.production_allowed);
  const why = !status?.live_key
    ? "Live needs ROQQU_SECRET_KEY on the API."
    : movesMoney && !status.production_allowed
      ? "Live moves real money. It needs ALLOW_PRODUCTION_EXECUTION=true on the API."
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
          Live on Roqqu
        </button>
      </div>
      <small>{mode === "practice" ? "Simulated with Roqqu's response shapes. No money moves." : "Real Roqqu API."} {why}</small>
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
    return <p className="biz-activity__empty">No activity yet. Payments, bills, KYC checks and payouts appear here.</p>;
  }
  return <History panel="" nonce={items.length} />;
}

/* --- bills ------------------------------------------------------------------ */

export function BillsPanel() {
  const [mode, setMode] = useState<Mode>("practice");
  const { busy, error, nonce, go } = useAction();
  const [meter, setMeter] = useState({ provider: "ikeja", meter_type: "prepaid", meter_number: "" });
  const [owner, setOwner] = useState<string | null>(null);
  const [buy, setBuy] = useState({ amount: "5000", phone_number: "" });
  const [receipt, setReceipt] = useState<{ token?: string; units_kwh?: string } | null>(null);
  const [airtime, setAirtime] = useState({ phone_number: "", amount: "500" });
  const [airtimeDone, setAirtimeDone] = useState<string | null>(null);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setOwner(null);
    setReceipt(null);
    const r = await go(() => runAction<{ cust_name: string }>("verify-meter", meter, mode));
    if (r) setOwner(r.data.cust_name);
  }
  async function pay(e: FormEvent) {
    e.preventDefault();
    const r = await go(() => runAction<{ token?: string; units_kwh?: string }>("pay-electricity", { ...meter, ...buy }, mode));
    if (r) setReceipt(r.data ?? {});
  }
  async function topUp(e: FormEvent) {
    e.preventDefault();
    setAirtimeDone(null);
    const r = await go(() => runAction("recharge-airtime", airtime, mode));
    if (r) setAirtimeDone(`${naira(airtime.amount)} airtime sent to ${airtime.phone_number}.`);
  }

  return (
    <Panel title="Pay bills" lead="Check the meter by name, then buy units. Roqqu keeps a ₦100 fee per electricity purchase." panel="bills" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <form className="svc-card" onSubmit={verify}>
        <h3>1. Check the meter</h3>
        <div className="svc-grid">
          <Field label="Distributor">
            <select value={meter.provider} onChange={(e) => setMeter({ ...meter, provider: e.target.value })}>
              {["ikeja", "eko", "abuja", "kano", "portharcourt", "ibadan", "kaduna", "jos", "enugu"].map((p) => (
                <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)} Electric</option>
              ))}
            </select>
          </Field>
          <Field label="Meter type">
            <select value={meter.meter_type} onChange={(e) => setMeter({ ...meter, meter_type: e.target.value })}>
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
          </Field>
          <Field label="Meter number" hint="11 to 13 digits">
            <input inputMode="numeric" value={meter.meter_number} placeholder="45055844760"
              onChange={(e) => setMeter({ ...meter, meter_number: e.target.value.trim() })} required />
          </Field>
        </div>
        <button className="svc-btn" disabled={busy}>Check meter</button>
        {owner ? <Notice kind="ok">This meter belongs to <b>{owner}</b>.</Notice> : null}
      </form>

      <form className={`svc-card${owner ? "" : " is-locked"}`} onSubmit={pay}>
        <h3>2. Buy units</h3>
        <div className="svc-grid">
          <Field label="Amount (₦)" hint="Minimum ₦500">
            <input inputMode="numeric" value={buy.amount} onChange={(e) => setBuy({ ...buy, amount: e.target.value })} required />
          </Field>
          <Field label="Customer phone">
            <input inputMode="tel" value={buy.phone_number} placeholder="08031234567"
              onChange={(e) => setBuy({ ...buy, phone_number: e.target.value.trim() })} required />
          </Field>
        </div>
        <button className="svc-btn svc-btn--primary" disabled={busy || !owner}>Buy {naira(buy.amount || 0)} of units</button>
        {receipt ? (
          <Notice kind="ok">
            Purchase complete.{" "}
            {receipt.token ? <>Token <code>{receipt.token}</code>, about {receipt.units_kwh} kWh.</> : "Roqqu confirmed the purchase."}
          </Notice>
        ) : null}
      </form>

      <form className="svc-card" onSubmit={topUp}>
        <h3>Airtime top-up</h3>
        <div className="svc-grid">
          <Field label="Phone number">
            <input inputMode="tel" value={airtime.phone_number} placeholder="08031234567"
              onChange={(e) => setAirtime({ ...airtime, phone_number: e.target.value.trim() })} required />
          </Field>
          <Field label="Amount (₦)">
            <input inputMode="numeric" value={airtime.amount} onChange={(e) => setAirtime({ ...airtime, amount: e.target.value })} required />
          </Field>
        </div>
        <button className="svc-btn" disabled={busy}>Send airtime</button>
        {airtimeDone ? <Notice kind="ok">{airtimeDone}</Notice> : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}

/* --- data ------------------------------------------------------------------- */

interface Plan {
  variation_code: string;
  name: string;
  variation_amount: string;
}

export function DataPanel() {
  const [mode, setMode] = useState<Mode>("practice");
  const { busy, error, nonce, go } = useAction();
  const [provider, setProvider] = useState("mtn");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setPicked(null);
    setDone(null);
    void go(() => runAction<Plan[]>("data-bundles", { provider }, mode)).then((r) => setPlans(r?.data ?? []));
  }, [provider, mode, go]);

  async function buy(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setDone(null);
    const r = await go(() => runAction<{ request_id?: string }>("buy-data", { provider, variation_code: picked, phone_number: phone }, mode));
    if (r) setDone(`Bundle active on ${phone}.${r.data?.request_id ? ` Request ${r.data.request_id}.` : ""}`);
  }

  return (
    <Panel title="Sell data bundles" lead="Pick a network, pick a plan, enter the customer's number. Plans come from Roqqu." panel="data" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <div className="svc-tabs" role="tablist" aria-label="Network">
        {[["mtn", "MTN"], ["airtel", "Airtel"], ["glo", "Glo"], ["etisalat", "9mobile"]].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={provider === id}
            className={provider === id ? "is-on" : ""} onClick={() => setProvider(id)}>{label}</button>
        ))}
      </div>
      <form className="svc-card" onSubmit={buy}>
        <div className="svc-plans" role="radiogroup" aria-label="Data plans">
          {plans.map((p) => (
            <button key={p.variation_code} type="button" role="radio" aria-checked={picked === p.variation_code}
              className={picked === p.variation_code ? "is-on" : ""} onClick={() => setPicked(p.variation_code)}>
              <b>{p.name}</b>
              <span>{naira(p.variation_amount)}</span>
            </button>
          ))}
          {plans.length === 0 && !busy ? <p className="svc-empty">No plans loaded.</p> : null}
        </div>
        <div className="svc-grid">
          <Field label="Customer phone">
            <input inputMode="tel" value={phone} placeholder="08031234567" onChange={(e) => setPhone(e.target.value.trim())} required />
          </Field>
        </div>
        <button className="svc-btn svc-btn--primary" disabled={busy || !picked}>Buy bundle</button>
        {done ? <Notice kind="ok">{done}</Notice> : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}

/* --- withdrawals ------------------------------------------------------------ */

export function WithdrawPanel() {
  const [mode, setMode] = useState<Mode>("practice");
  const { busy, error, nonce, go } = useAction();
  const [form, setForm] = useState({ token: "trx", addr: "", amount: "" });
  const [checked, setChecked] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setChecked(null);
    setSent(null);
    const r = await go(() => runAction("check-address", { symbol: form.token, addr: form.addr }, mode));
    if (r) setChecked(form.addr);
  }
  async function send() {
    const r = await go(() => runAction("send-token", { token: form.token, amount: form.amount, wallet: form.addr }, mode));
    if (r) setSent(`${form.amount} ${form.token.toUpperCase()} sent to ${form.addr.slice(0, 10)}…`);
  }

  return (
    <Panel title="Customer withdrawals" lead="Check the address on Roqqu first, then send. Address lookups are limited to one every 100 seconds." panel="withdraw" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <form className="svc-card" onSubmit={check}>
        <div className="svc-grid">
          <Field label="Coin">
            <select value={form.token} onChange={(e) => { setForm({ ...form, token: e.target.value }); setChecked(null); }}>
              <option value="trx">Tron (TRX)</option>
              <option value="eth">Ethereum (ETH)</option>
              <option value="btc">Bitcoin (BTC)</option>
            </select>
          </Field>
          <Field label="Customer's address">
            <input value={form.addr} placeholder={form.token === "eth" ? "0x…" : form.token === "btc" ? "bc1… or 1… / 3…" : "T…"}
              onChange={(e) => { setForm({ ...form, addr: e.target.value.trim() }); setChecked(null); }} required />
          </Field>
          <Field label={`Amount (${form.token.toUpperCase()})`}>
            <input inputMode="decimal" value={form.amount} placeholder="10" onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
          </Field>
        </div>
        <div className="svc-row">
          <button className="svc-btn" disabled={busy}>Check address</button>
          <button type="button" className="svc-btn svc-btn--primary" disabled={busy || checked !== form.addr || !form.amount}
            onClick={() => void send()}>
            Send {form.amount || 0} {form.token.toUpperCase()}
          </button>
        </div>
        {checked === form.addr ? <Notice kind="ok">Address checked. You can send.</Notice> : null}
        {sent ? <Notice kind="ok">{sent}</Notice> : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}

/* --- KYC -------------------------------------------------------------------- */

export function KycPanel() {
  const [mode, setMode] = useState<Mode>("practice");
  const { busy, error, nonce, go } = useAction();
  const [idType, setIdType] = useState<"bvn" | "nin">("bvn");
  const [idNumber, setIdNumber] = useState("");
  const [person, setPerson] = useState<{ name: string; masked: string } | null>(null);
  const [banks, setBanks] = useState<string[]>([]);
  const [acct, setAcct] = useState({ account_number: "", bank: "" });
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    void go(() => runAction<string[]>("get-banks", {}, mode)).then((r) => setBanks(Array.isArray(r?.data) ? r!.data : []));
  }, [mode, go]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setPerson(null);
    const r = await go(() => runAction<Record<string, string>>(idType === "bvn" ? "bvn-verify" : "nin-verify", { [idType]: idNumber }, mode));
    if (r) setPerson({ name: r.data.name, masked: r.data[idType] });
  }
  async function resolve(e: FormEvent) {
    e.preventDefault();
    setResolved(null);
    const r = await go(() => runAction<string>("account-resolve", acct, mode));
    if (r) setResolved(r.data);
  }

  return (
    <Panel title="Verify customers (KYC)" lead="Roqqu charges ₦20 per successful BVN check and ₦100 per NIN check. Only the name and a masked number are shown." panel="kyc" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <form className="svc-card" onSubmit={verify}>
        <h3>Identity</h3>
        <div className="svc-tabs" role="tablist" aria-label="ID type">
          {(["bvn", "nin"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={idType === t} className={idType === t ? "is-on" : ""}
              onClick={() => { setIdType(t); setPerson(null); }}>{t.toUpperCase()}</button>
          ))}
        </div>
        <div className="svc-grid">
          <Field label={`${idType.toUpperCase()} number`} hint="11 digits">
            <input inputMode="numeric" value={idNumber} onChange={(e) => setIdNumber(e.target.value.trim())} required />
          </Field>
        </div>
        <button className="svc-btn svc-btn--primary" disabled={busy}>Verify {idType.toUpperCase()}</button>
        {person ? <Notice kind="ok">Verified: <b>{person.name}</b> ({idType.toUpperCase()} {person.masked}).</Notice> : null}
      </form>
      <form className="svc-card" onSubmit={resolve}>
        <h3>Payout bank account</h3>
        <div className="svc-grid">
          <Field label="Bank">
            <select value={acct.bank} onChange={(e) => setAcct({ ...acct, bank: e.target.value })} required>
              <option value="">Choose a bank</option>
              {banks.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Account number" hint="10 digits">
            <input inputMode="numeric" value={acct.account_number} onChange={(e) => setAcct({ ...acct, account_number: e.target.value.trim() })} required />
          </Field>
        </div>
        <button className="svc-btn" disabled={busy}>Confirm account name</button>
        {resolved ? (
          <Notice kind={person && !resolved.toUpperCase().includes(person.name.split(" ").slice(-1)[0]) ? "bad" : "ok"}>
            Account holder: <b>{resolved}</b>
            {person && !resolved.toUpperCase().includes(person.name.split(" ").slice(-1)[0]) ? ". This does not match the verified name." : "."}
          </Notice>
        ) : null}
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
  const [token, setToken] = useState<"trx" | "eth" | "btc">("trx");
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
    <Panel title="Pay staff in crypto" lead="Enter each person's wallet and naira amount. Studio prices it at Roqqu's rate and skips any address that is not valid." panel="payroll" nonce={nonce}>
      <ModeSwitch mode={mode} onChange={setMode} movesMoney />
      <form className="svc-card" onSubmit={pay}>
        <div className="svc-grid">
          <Field label="Pay in">
            <select value={token} onChange={(e) => setToken(e.target.value as "trx" | "eth" | "btc")}>
              <option value="trx">Tron (TRX)</option>
              <option value="eth">Ethereum (ETH)</option>
              <option value="btc">Bitcoin (BTC)</option>
            </select>
          </Field>
        </div>
        <table className="svc-table">
          <thead>
            <tr><th>Name</th><th>{token.toUpperCase()} wallet</th><th>Amount (₦)</th><th aria-label="Remove" /></tr>
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
                <b>{r.name}</b> <code>{r.amount_token} {token.toUpperCase()}</code> {r.message}
              </li>
            ))}
          </ul>
        ) : null}
      </form>
      {error ? <Notice kind="bad">{error}</Notice> : null}
    </Panel>
  );
}
