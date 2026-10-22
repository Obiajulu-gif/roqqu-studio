/**
 * The whole onboarding: three fields and one button. A wallet on every
 * network is created behind the scenes; a returning owner signs in with an
 * emailed link instead of a password.
 */
"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { bizPost, useBusiness } from "./useBusiness";

export function Onboarding() {
  const { refresh } = useBusiness();
  const params = useSearchParams();
  const [mode, setMode] = useState<"create" | "signin">("create");
  const [form, setForm] = useState({ owner_name: "", business_name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params?.get("signin") === "expired" ? "That sign-in link expired or was already used. Ask for a new one." : null,
  );
  const [sent, setSent] = useState<{ message: string; dev_link?: string } | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await bizPost("/api/biz/onboard", form);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your business");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSent(await bizPost<{ message: string; dev_link?: string }>("/api/biz/login", { email: form.email }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the link");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="ob">
      <div className="ob-card">
        <Image src="/figma/roqqu-logo.svg" alt="" width={36} height={36} />
        {mode === "create" ? (
          <>
            <h1>Set up your business</h1>
            <p className="ob-lead">Your name and business name go on every invoice and on your store. We create your Roqqu wallets for you.</p>
            <form onSubmit={create} className="ob-form">
              <label className="svc-field">
                <span>Your name</span>
                <input autoComplete="name" value={form.owner_name} onChange={set("owner_name")} placeholder="Ada Obi" required minLength={2} maxLength={80} autoFocus />
              </label>
              <label className="svc-field">
                <span>Business name</span>
                <input autoComplete="organization" value={form.business_name} onChange={set("business_name")} placeholder="Ada's Kitchen" required minLength={2} maxLength={80} />
              </label>
              <label className="svc-field">
                <span>Email</span>
                <input type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="ada@example.com" required />
                <small>For sign-in links and the codes that confirm a send.</small>
              </label>
              <button className="svc-btn svc-btn--primary ob-submit" disabled={busy}>
                {busy ? "Creating your business…" : "Create my business"}
              </button>
            </form>
            <p className="ob-switch">
              Already set up? <button type="button" className="svc-link" onClick={() => { setMode("signin"); setError(null); }}>Sign in</button>
            </p>
          </>
        ) : (
          <>
            <h1>Sign in</h1>
            <p className="ob-lead">We email you a link that signs you in. It works once, for 20 minutes.</p>
            <form onSubmit={signIn} className="ob-form">
              <label className="svc-field">
                <span>Email</span>
                <input type="email" autoComplete="email" value={form.email} onChange={set("email")} required autoFocus />
              </label>
              <button className="svc-btn svc-btn--primary ob-submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
            </form>
            {sent ? (
              <div className="svc-notice is-ok" role="status">
                {sent.message}
                {sent.dev_link ? <> No email service is set up, so here is the link: <a href={sent.dev_link}>sign in</a>.</> : null}
              </div>
            ) : null}
            <p className="ob-switch">
              New here? <button type="button" className="svc-link" onClick={() => { setMode("create"); setSent(null); setError(null); }}>Set up a business</button>
            </p>
          </>
        )}
        {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}
