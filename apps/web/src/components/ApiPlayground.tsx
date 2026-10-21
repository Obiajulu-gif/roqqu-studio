/**
 * Roqqu API playground: every endpoint from developers.roqqu.com, with live
 * JavaScript, example responses and real calls through the studio's server.
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { getJson, postJson } from "@/lib/http";
import {
  axiosSnippet,
  clientModule,
  clientSnippet,
  defaultValues,
  fetchSnippet,
  webhookSnippet,
  type ParamValues,
  type RoqquCatalog,
  type RoqquEndpoint,
} from "@/lib/roqquCode";

type CodeTab = "axios" | "fetch" | "client";
const WEBHOOK_ID = "__webhook__";

interface CallResult {
  status: number;
  elapsed_ms: number;
  request: { method: string; url: string };
  response: unknown;
}

type Shown =
  | { kind: "none" }
  | { kind: "example"; code: string; body: unknown }
  | { kind: "live"; result: CallResult }
  | { kind: "error"; message: string };

function pretty(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function blockedReason(catalog: RoqquCatalog, e: RoqquEndpoint): string | null {
  if (e.auth && !catalog.live_key) return "Needs ROQQU_SECRET_KEY on the API.";
  const sideEffect = e.moves_money || e.paid_lookup || e.id === "generate-wallet" || e.id === "delete-wallet";
  if (sideEffect && !catalog.production_allowed) {
    return "Changes real money or wallets. Needs ALLOW_PRODUCTION_EXECUTION=true on the API.";
  }
  return null;
}

export function ApiPlayground() {
  const [catalog, setCatalog] = useState<RoqquCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("get-price");
  const [values, setValues] = useState<ParamValues>({});
  const [tab, setTab] = useState<CodeTab>("axios");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<Shown>({ kind: "none" });
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getJson<RoqquCatalog>("/playground/endpoints")
      .then(setCatalog)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "API unreachable"));
  }, []);

  const endpoint = useMemo(
    () => catalog?.endpoints.find((e) => e.id === selected) ?? null,
    [catalog, selected],
  );

  useEffect(() => {
    if (endpoint) setValues(defaultValues(endpoint));
    setShown({ kind: "none" });
  }, [endpoint]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const groups = new Map<string, RoqquEndpoint[]>();
    for (const e of catalog?.endpoints ?? []) {
      if (q && !`${e.title} ${e.path} ${e.section}`.toLowerCase().includes(q)) continue;
      groups.set(e.section, [...(groups.get(e.section) ?? []), e]);
    }
    return [...groups.entries()];
  }, [catalog, query]);

  const code = useMemo(() => {
    if (!catalog) return "";
    if (selected === WEBHOOK_ID) return webhookSnippet();
    if (!endpoint) return "";
    if (tab === "fetch") return fetchSnippet(catalog, endpoint, values);
    if (tab === "client") return clientSnippet(endpoint, values);
    return axiosSnippet(catalog, endpoint, values);
  }, [catalog, endpoint, selected, tab, values]);

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }

  function downloadClient() {
    if (!catalog) return;
    const url = URL.createObjectURL(new Blob([clientModule(catalog)], { type: "text/javascript" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "roqqu.js";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function send() {
    if (!endpoint) return;
    setSending(true);
    try {
      const result = await postJson<CallResult>("/playground/call", { endpoint: endpoint.id, params: values });
      setShown({ kind: "live", result });
    } catch (err) {
      setShown({ kind: "error", message: err instanceof Error ? err.message : "Request failed" });
    } finally {
      setSending(false);
    }
  }

  if (loadError) {
    return (
      <div className="pg-shell pg-shell--empty">
        <p>Could not load the Roqqu API catalog: {loadError}. Start the API server and reload.</p>
      </div>
    );
  }
  if (!catalog) {
    return <div className="pg-shell pg-shell--empty"><p>Loading the Roqqu API…</p></div>;
  }

  const blocked = endpoint ? blockedReason(catalog, endpoint) : null;
  const exampleCodes = endpoint ? Object.keys(endpoint.examples) : [];

  return (
    <div className="pg-shell">
      <header className="pg-top">
        <Link href="/studio/developer" className="pg-brand">
          <Image src="/figma/roqqu-logo.svg" alt="" width={22} height={22} />
          <span>Roqqu Studio</span>
        </Link>
        <h1>API playground</h1>
        <code className="pg-base">{catalog.base_url}</code>
        <div className="pg-top__right">
          <span className={`pg-chip ${catalog.live_key ? "is-ok" : ""}`}>
            {catalog.live_key ? "Secret key connected" : "No secret key: public calls only"}
          </span>
          <span className={`pg-chip ${catalog.production_allowed ? "is-warn" : ""}`}>
            {catalog.production_allowed ? "Real-money calls allowed" : "Real-money calls blocked"}
          </span>
          <button type="button" className="pg-btn" onClick={downloadClient}>
            Download roqqu.js
          </button>
          <Link href="/studio/developer" className="pg-btn pg-btn--ghost">
            Developer tools
          </Link>
        </div>
      </header>

      <aside className="pg-nav" aria-label="Roqqu endpoints">
        <input
          className="pg-search"
          placeholder="Search endpoints"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search endpoints"
        />
        {sections.map(([section, list]) => (
          <div key={section} className="pg-nav__group">
            <h2>{section}</h2>
            <ul>
              {list.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={e.id === selected ? "is-active" : ""}
                    onClick={() => setSelected(e.id)}
                  >
                    <span className={`pg-method pg-method--${e.method.toLowerCase()}`}>{e.method}</span>
                    <span className="pg-nav__title">{e.title}</span>
                    {e.moves_money ? <span className="pg-dot" title="Moves real money" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="pg-nav__group">
          <h2>Webhooks</h2>
          <ul>
            <li>
              <button
                type="button"
                className={selected === WEBHOOK_ID ? "is-active" : ""}
                onClick={() => setSelected(WEBHOOK_ID)}
              >
                <span className="pg-method pg-method--hook">HOOK</span>
                <span className="pg-nav__title">Receive Token</span>
              </button>
            </li>
          </ul>
        </div>
      </aside>

      <main className="pg-main">
        {selected === WEBHOOK_ID ? (
          <section className="pg-detail">
            <h2>{catalog.webhook.title}</h2>
            <p className="pg-summary">{catalog.webhook.summary}</p>
            <p className="pg-note">{catalog.webhook.note}</p>
            <h3>Payload Roqqu sends</h3>
            <pre className="pg-pre">{pretty(catalog.webhook.payload)}</pre>
            <a className="pg-doc" href={catalog.webhook.doc_url} target="_blank" rel="noopener noreferrer">
              Read the Roqqu docs
            </a>
          </section>
        ) : endpoint ? (
          <section className="pg-detail">
            <div className="pg-endpoint">
              <span className={`pg-method pg-method--${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
              <code>{endpoint.path}</code>
              {endpoint.auth ? <span className="pg-tag">Secret key</span> : <span className="pg-tag">Public</span>}
              {endpoint.moves_money ? <span className="pg-tag is-danger">Moves money</span> : null}
              {endpoint.paid_lookup ? <span className="pg-tag is-warn">Paid lookup</span> : null}
            </div>
            <h2>{endpoint.title}</h2>
            <p className="pg-summary">{endpoint.summary}</p>
            {endpoint.note ? <p className={`pg-note${endpoint.moves_money ? " is-danger" : ""}`}>{endpoint.note}</p> : null}

            <h3>Parameters</h3>
            {endpoint.params.length === 0 ? (
              <p className="pg-muted">None. This endpoint takes no input.</p>
            ) : (
              <div className="pg-form">
                {endpoint.params.map((p) => (
                  <label key={p.name}>
                    <span className="pg-form__name">
                      <code>{p.name}</code>
                      {p.required ? <em>required</em> : <em className="is-optional">optional</em>}
                      <small>{p.in === "path" ? "in path" : p.in === "query" ? "in query" : "in body"}</small>
                    </span>
                    <input
                      value={values[p.name] ?? ""}
                      inputMode={p.type === "number" ? "decimal" : undefined}
                      onChange={(ev) => setValues((v) => ({ ...v, [p.name]: ev.target.value }))}
                    />
                    {p.description ? <span className="pg-form__help">{p.description}</span> : null}
                  </label>
                ))}
              </div>
            )}

            <div className="pg-actions">
              <button
                type="button"
                className="pg-btn pg-btn--primary"
                onClick={() => void send()}
                disabled={sending || !!blocked}
              >
                {sending ? "Sending…" : "Send request"}
              </button>
              {exampleCodes.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="pg-btn pg-btn--ghost"
                  onClick={() => setShown({ kind: "example", code: c, body: endpoint.examples[c] })}
                >
                  Example {c} response
                </button>
              ))}
              <a className="pg-doc" href={endpoint.doc_url} target="_blank" rel="noopener noreferrer">
                Roqqu docs
              </a>
            </div>
            {blocked ? <p className="pg-muted">{blocked} Example responses still work.</p> : null}

            {shown.kind !== "none" && (
              <div className="pg-response" aria-live="polite">
                {shown.kind === "live" && (
                  <p className="pg-response__meta">
                    <span className={shown.result.status < 400 ? "is-ok" : "is-bad"}>HTTP {shown.result.status}</span>
                    {shown.result.elapsed_ms} ms · live from Roqqu
                  </p>
                )}
                {shown.kind === "example" && (
                  <p className="pg-response__meta">
                    <span className={shown.code.startsWith("2") ? "is-ok" : "is-bad"}>HTTP {shown.code}</span>
                    Example from the Roqqu docs
                  </p>
                )}
                {shown.kind === "error" ? (
                  <p className="pg-response__error">
                    {shown.message}
                    {exampleCodes.length ? " Use an example response above to see the shape Roqqu returns." : ""}
                  </p>
                ) : (
                  <pre className="pg-pre">
                    {pretty(shown.kind === "live" ? shown.result.response : shown.body)}
                  </pre>
                )}
              </div>
            )}
          </section>
        ) : null}
      </main>

      <section className="pg-code" aria-label="JavaScript">
        <div className="pg-code__tabs" role="tablist">
          {selected === WEBHOOK_ID ? (
            <button type="button" role="tab" aria-selected className="is-active">Express handler</button>
          ) : (
            (
              [
                ["axios", "axios"],
                ["fetch", "fetch"],
                ["client", "roqqu.js"],
              ] as [CodeTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "is-active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))
          )}
          <button type="button" className="pg-copy" onClick={() => copy(code)}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className="pg-pre pg-pre--code">{code}</pre>
        <p className="pg-code__hint">
          {tab === "client" && selected !== WEBHOOK_ID
            ? "Uses roqqu.js from the Download button. One function per Roqqu endpoint."
            : "Run it on your server. Never put your secret key in browser code."}
        </p>
      </section>
    </div>
  );
}
