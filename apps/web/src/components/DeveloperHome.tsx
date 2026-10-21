/**
 * Developer home: three tools, a four-step path to going live, and the
 * server's real readiness (key set? real money allowed?).
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getJson } from "@/lib/http";

interface Status {
  live_key: boolean;
  production_allowed: boolean;
}

const TOOLS = [
  {
    href: "/studio/playground",
    title: "API playground",
    body: "Every Roqqu endpoint with a form, live axios, fetch and roqqu.js code, example responses and real calls.",
    cta: "Try the Roqqu API",
  },
  {
    href: "/studio/canvas",
    title: "Flow canvas",
    body: "Drag Roqqu blocks into a payment flow. A safety review blocks unsafe payouts; Run it, then copy the Python.",
    cta: "Build a flow",
  },
  {
    href: "/studio/playground",
    title: "roqqu.js client",
    body: "One dependency-free file with a function per endpoint. Download it from the playground's top bar.",
    cta: "Get roqqu.js",
  },
];

const STEPS = [
  { title: "Try an endpoint", body: "Open the playground and send a public call, such as Get price." },
  { title: "Add your secret key", body: "Set ROQQU_SECRET_KEY on the API server (Roqqu dashboard, Security)." },
  { title: "Build and review a flow", body: "Start from a template on the canvas; fix anything the review flags." },
  { title: "Go live", body: "Set ALLOW_PRODUCTION_EXECUTION=true when you are ready to move real crypto." },
];

export function DeveloperHome() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    getJson<Status>("/services/status").then(setStatus).catch(() => setStatus(null));
  }, []);

  return (
    <div className="sh dv">
      <header className="sh-top">
        <Link href="/studio" className="bz-brand">
          <Image src="/figma/roqqu-logo.svg" alt="" width={24} height={24} />
          <span>Roqqu Studio</span>
        </Link>
        <nav className="dv-nav" aria-label="Developer">
          <Link href="/studio/playground">API playground</Link>
          <Link href="/studio/canvas">Flow canvas</Link>
          <a href="https://developers.roqqu.com" target="_blank" rel="noopener noreferrer">Roqqu docs</a>
          <Link href="/studio/business">Business tools</Link>
        </nav>
      </header>
      <main className="dv-main">
        <h1>Developer tools</h1>
        <p className="dv-lead">Build on the Roqqu API with working code from the first minute.</p>

        <div className="dv-status" aria-live="polite">
          <span className={status?.live_key ? "is-ok" : ""}>
            {status === null ? "Checking the API…" : status.live_key ? "Secret key connected" : "No secret key yet: public calls and Practice only"}
          </span>
          <span className={status?.production_allowed ? "is-warn" : ""}>
            {status?.production_allowed ? "Real-money calls allowed" : "Real-money calls blocked"}
          </span>
        </div>

        <div className="dv-tools">
          {TOOLS.map((t) => (
            <Link key={t.title} href={t.href} className="dv-tool">
              <h2>{t.title}</h2>
              <p>{t.body}</p>
              <span className="sh-door__cta">{t.cta}</span>
            </Link>
          ))}
        </div>

        <section aria-labelledby="path-title">
          <h2 id="path-title" className="dv-h2">From first call to live</h2>
          <ol className="dv-steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <b>{s.title}</b>
                <span>{s.body}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
