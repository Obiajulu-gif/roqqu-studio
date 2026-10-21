/**
 * /studio: the one decision a visitor has to make first (Hick's law: two
 * doors, nothing else competing for attention).
 */
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

const DOORS = [
  {
    href: "/studio/business",
    title: "I run a business",
    body: "Sell online, send invoices, run an ajo, pay staff, sell bills and data, verify customers.",
    cta: "Open my business tools",
    key: "business",
  },
  {
    href: "/studio/developer",
    title: "I'm a developer",
    body: "Build payment flows on a canvas, try every Roqqu endpoint, copy JavaScript and Python.",
    cta: "Open developer tools",
    key: "developer",
  },
] as const;

export function StudioHome() {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    try {
      setLast(window.localStorage.getItem("rq.studio.door"));
    } catch {
      setLast(null);
    }
  }, []);

  return (
    <div className="sh">
      <header className="sh-top">
        <Link href="/" className="bz-brand">
          <Image src="/figma/roqqu-logo.svg" alt="" width={24} height={24} />
          <span>Roqqu Studio</span>
        </Link>
      </header>
      <main className="sh-main">
        <h1>What do you want to do today?</h1>
        <p>Pick one. You can switch between them at any time.</p>
        <div className="sh-doors">
          {DOORS.map((d) => (
            <Link
              key={d.key}
              href={d.href}
              className={`sh-door${last === d.key ? " is-last" : ""}`}
              onClick={() => {
                try {
                  window.localStorage.setItem("rq.studio.door", d.key);
                } catch {
                  /* storage blocked */
                }
              }}
            >
              {last === d.key ? <span className="sh-door__tag">Where you left off</span> : null}
              <h2>{d.title}</h2>
              <p>{d.body}</p>
              <span className="sh-door__cta">{d.cta}</span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
