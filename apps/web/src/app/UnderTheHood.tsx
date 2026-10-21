"use client";

import { useState } from "react";

import styles from "./landing.module.css";

const TABS = [
  { id: "code", label: "Generated code" },
  { id: "review", label: "Safety review" },
  { id: "webhook", label: "Webhook check" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const CODE = `def verify_deposit(ctx, *, client, token):
    """Get Wallets (verify deposit) (roqqu.get_wallets).

    Docs: https://developers.roqqu.com/reference/get-wallets-1
    """
    wallets = _data(client.post(
        f"{BASE_URL}/user/wallets",
        headers={"Authorization": f"Bearer {token}"},
        json={"token": TOKEN},
    )) or []
    mine = next((w for w in wallets if w["address"] == ctx["address"]), None)
    if mine is None:
        raise GuardFailed("deposit address is not one of our wallets")
    ctx["paid_amount"] = Decimal(str(mine["total_received"]))
    return ctx`;

const WEBHOOK = `POST /roqqu/webhook
{
  "secret": "••••••••",
  "token": "trx",
  "amount": "16.00",
  "address": "TXq7…9kF2",
  "timestamp": "2026-10-21T10:00:00Z"
}

secret matches the one on your Roqqu dashboard   ok
payload treated as a trigger only                ok
Get Wallets re-read: 16.00 TRX received           ok
order INV-2041 marked paid                        ok`;

const FINDINGS = [
  { rule: "MON002", title: "Webhook reaches the order without a secret check", fixed: true },
  { rule: "MON003", title: "No idempotency guard before the order is fulfilled", fixed: true },
  { rule: "MON004", title: "Amount paid never compared with the invoice total", fixed: true },
  { rule: "MON011", title: "Payout wallet not validated before Send Token", fixed: true },
];

export function UnderTheHood() {
  const [tab, setTab] = useState<TabId>("code");

  return (
    <div className={styles.hood}>
      <div className={styles.hoodTabs} role="tablist" aria-label="Under the hood">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`hood-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`hood-panel-${t.id}`}
            className={tab === t.id ? styles.hoodTabActive : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className={styles.hoodPanel}
        role="tabpanel"
        id={`hood-panel-${tab}`}
        aria-labelledby={`hood-tab-${tab}`}
      >
        {tab === "code" && <pre className={styles.code}>{CODE}</pre>}
        {tab === "webhook" && <pre className={styles.code}>{WEBHOOK}</pre>}
        {tab === "review" && (
          <ul className={styles.findings}>
            {FINDINGS.map((f) => (
              <li key={f.rule}>
                <code>{f.rule}</code>
                <span>{f.title}</span>
                <em>Fixed with Apply Fix</em>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
