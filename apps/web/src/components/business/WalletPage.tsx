/**
 * The business wallet: balances, an address per network to receive on, and a
 * send form that only moves money after the emailed 6-digit code.
 */
"use client";

import { QRCodeSVG } from "qrcode.react";
import { useState, type FormEvent } from "react";

import { bizPost, useBusiness, useMe, type BizWallet } from "./useBusiness";

const KIND_LABEL: Record<string, string> = {
  payment: "Invoice paid",
  deposit: "Deposit",
  send: "Sent",
  send_reversal: "Send reversed",
  refund: "Send refunded",
};

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="svc-btn"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? "Copied" : "Copy address"}
    </button>
  );
}

function AddressCard({ wallet }: { wallet: BizWallet }) {
  return (
    <article className="wl-addr">
      <header>
        <b>{wallet.label}</b>
        <span>{wallet.token.toUpperCase()} only</span>
      </header>
      <div className="wl-addr__qr">
        <QRCodeSVG value={wallet.address} size={116} bgColor="#ffffff" fgColor="#0d1422" marginSize={2} />
      </div>
      <code>{wallet.address}</code>
      <CopyButton text={wallet.address} />
    </article>
  );
}

export function WalletPage() {
  const me = useMe();
  const { refresh } = useBusiness();
  const [send, setSend] = useState({ network: "trc20", to: "", amount: "" });
  const [pending, setPending] = useState<{ id: string; summary: string; dev_code?: string; fee: string } | null>(null);
  const [code, setCode] = useState("");
  const [deposit, setDeposit] = useState({ network: "bep20", amount: "50" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const token = send.network === "bitcoin" ? "BTC" : "USDT";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const startSend = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const res = await bizPost<{ send: { id: string; amount: string; token: string; to_address: string }; fee: string; dev_code?: string }>(
        "/api/biz/sends",
        send,
      );
      setPending({
        id: res.send.id,
        fee: res.fee,
        dev_code: res.dev_code,
        summary: `${res.send.amount} ${res.send.token.toUpperCase()} to ${res.send.to_address.slice(0, 12)}…`,
      });
      setCode("");
    });
  };

  const confirm = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    void run(async () => {
      const res = await bizPost<{ send: { refid: string } }>(`/api/biz/sends/${pending.id}/confirm`, { code });
      setNotice(`Sent ${pending.summary}. Roqqu queued it (refid ${res.send.refid}) and confirms it on-chain shortly.`);
      setPending(null);
      setSend({ ...send, to: "", amount: "" });
      await refresh();
    });
  };

  const practiceDeposit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await bizPost("/api/biz/practice/deposit", deposit);
      setNotice(`Practice deposit of ${deposit.amount} ${deposit.network === "bitcoin" ? "BTC" : "USDT"} credited.`);
      await refresh();
    });
  };

  if (me.business.wallet_status !== "ready") {
    return (
      <div className="svc-notice is-info" role="status">
        Your wallets are not ready yet{me.business.wallet_error ? `: ${me.business.wallet_error}` : "."}{" "}
        <button type="button" className="svc-link" disabled={busy} onClick={() => void run(async () => { await bizPost("/api/biz/wallets/retry"); await refresh(); })}>
          Retry wallet setup
        </button>
        {error ? <p>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="wl">
      <section className="wl-balances" aria-label="Balances">
        <div><span>USDT</span><b>{Number(me.balances.usdt ?? 0).toLocaleString("en-US", { maximumFractionDigits: 6 })}</b></div>
        <div><span>BTC</span><b>{Number(me.balances.btc ?? 0).toLocaleString("en-US", { maximumFractionDigits: 8 })}</b></div>
        <p>
          {me.mode === "practice"
            ? "Practice mode: balances are simulated."
            : me.mode === "test"
              ? "Roqqu test mode: no real money."
              : "Live: real money."}
        </p>
      </section>

      <section aria-labelledby="receive-title">
        <h2 id="receive-title" className="wl-h">Receive</h2>
        <p className="wl-lead">Share an address, or let invoices and your store do it. Each address only accepts its own coin and network.</p>
        <div className="wl-addrs">{me.wallets.map((w) => <AddressCard key={w.network} wallet={w} />)}</div>
        {me.mode === "practice" ? (
          <form className="svc-card wl-practice" onSubmit={practiceDeposit}>
            <b>Try it: simulate a deposit</b>
            <div className="svc-grid">
              <label className="svc-field">
                <span>To</span>
                <select value={deposit.network} onChange={(e) => setDeposit({ ...deposit, network: e.target.value })}>
                  {me.wallets.map((w) => <option key={w.network} value={w.network}>{w.label}</option>)}
                </select>
              </label>
              <label className="svc-field">
                <span>Amount</span>
                <input inputMode="decimal" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} />
              </label>
            </div>
            <button className="svc-btn" disabled={busy}>Simulate deposit</button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="send-title">
        <h2 id="send-title" className="wl-h">Send</h2>
        <p className="wl-lead">
          Roqqu checks the address is on the network you pick. Every send needs the code we email to {me.business.email}.
          Daily limit: ${me.daily_cap_usd}.
        </p>
        {!pending ? (
          <form className="svc-card" onSubmit={startSend}>
            <div className="svc-grid">
              <label className="svc-field">
                <span>Coin and network</span>
                <select value={send.network} onChange={(e) => setSend({ ...send, network: e.target.value })}>
                  {me.wallets.map((w) => <option key={w.network} value={w.network}>{w.label}</option>)}
                </select>
              </label>
              <label className="svc-field">
                <span>To address</span>
                <input value={send.to} onChange={(e) => setSend({ ...send, to: e.target.value.trim() })}
                  placeholder={send.network === "bep20" ? "0x…" : send.network === "trc20" ? "T…" : "bc1…"} required />
              </label>
              <label className="svc-field">
                <span>Amount ({token})</span>
                <input inputMode="decimal" value={send.amount} onChange={(e) => setSend({ ...send, amount: e.target.value })} required />
              </label>
            </div>
            <button className="svc-btn svc-btn--primary" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
          </form>
        ) : (
          <form className="svc-card" onSubmit={confirm}>
            <b>Confirm sending {pending.summary}</b>
            <p className="wl-lead">
              Network fee about {pending.fee} {token}, taken from the coin sent. Enter the 6-digit code from your email.
            </p>
            {pending.dev_code ? (
              <div className="svc-notice is-info">No email service is set up, so here is the code: <code>{pending.dev_code}</code></div>
            ) : null}
            <label className="svc-field">
              <span>Code</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus />
            </label>
            <div className="svc-row">
              <button className="svc-btn svc-btn--primary" disabled={busy || code.length !== 6}>{busy ? "Sending…" : "Send now"}</button>
              <button type="button" className="svc-btn" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      {notice ? <div className="svc-notice is-ok" role="status">{notice}</div> : null}
      {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}

      <section aria-labelledby="activity-title">
        <h2 id="activity-title" className="wl-h">Activity</h2>
        {me.ledger.length === 0 ? (
          <p className="svc-empty">No money in or out yet.</p>
        ) : (
          <ul className="wl-activity">
            {me.ledger.map((row, i) => (
              <li key={i} className={Number(row.amount) >= 0 ? "is-in" : "is-out"}>
                <span>{KIND_LABEL[row.kind] ?? row.kind}</span>
                <b>{Number(row.amount) >= 0 ? "+" : ""}{Number(row.amount).toLocaleString("en-US", { maximumFractionDigits: 8 })} {row.token.toUpperCase()}</b>
                <time>{new Date(row.created_at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
