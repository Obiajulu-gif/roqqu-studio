/**
 * The savings group (ajo) tool. It owns a generated payment product (template
 * workflow + artifact) that it creates on first use and remembers in this
 * browser. Store and invoices live in StoreManager / InvoicesManager.
 */
"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AjoPanel, type AjoPanelHandle } from "@/components/AjoPanel";
import { createFromTemplate, generateArtifact } from "@/lib/api";
import { ApiError, getJson } from "@/lib/http";

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
