"use client";

import { useState } from "react";

import { webhookSnippet } from "@/lib/roqquCode";

import styles from "./landing.module.css";

const TABS = [
  { id: "axios", label: "axios" },
  { id: "client", label: "roqqu.js" },
  { id: "webhook", label: "Webhook handler" },
  { id: "review", label: "Safety review" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const AXIOS = `const axios = require('axios');

const options = {
  method: 'POST',
  url: 'https://service.roqqu.com/v1/payment-links',
  headers: {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'x-staging-api-key': process.env.RAS_TEST_KEY
  },
  data: new URLSearchParams({
    amount: '150000',
    amount_currency: 'ngn',
    customer_details: JSON.stringify({ email: 'ada@example.com', first_name: 'Ada', last_name: 'Obi' }),
    payment_reference: 'INV2041',
    success_url: 'https://yourshop.com/paid',
    cancel_url: 'https://yourshop.com/cancelled'
  })
};

axios
  .request(options)
  .then((res) => console.log(res.data))
  .catch((err) => console.error(err.response?.data ?? err.message));`;

const CLIENT = `// npm needs nothing: roqqu.js is one file from the playground.
const roqqu = require('./roqqu')({ testKey: process.env.RAS_TEST_KEY });

const { address } = await roqqu.generateWallet({
  network: 'trc20',
  customer: { email: 'ada@example.com', first_name: 'Ada', last_name: 'Obi' }
});
const networks = await roqqu.whatNetwork({ address });
const { refid } = await roqqu.sendCoin({ amount: '5', network: 'trc20', to: address, token: 'usdt' });

console.log(address, networks, refid);`;

const FINDINGS = [
  { rule: "MON002", title: "Webhook reaches the order without being decrypted" },
  { rule: "MON003", title: "No idempotency guard before the order is fulfilled" },
  { rule: "MON004", title: "Amount paid never compared with the invoice total" },
  { rule: "MON011", title: "Payout address not checked before Send" },
];

export function UnderTheHood() {
  const [tab, setTab] = useState<TabId>("axios");

  return (
    <div className={styles.hood}>
      <div className={styles.hoodTabs} role="tablist" aria-label="Developer tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`hood-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="hood-panel"
            className={tab === t.id ? styles.hoodTabActive : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.hoodPanel} role="tabpanel" id="hood-panel" aria-labelledby={`hood-tab-${tab}`}>
        {tab === "axios" && <pre className={styles.code}>{AXIOS}</pre>}
        {tab === "client" && <pre className={styles.code}>{CLIENT}</pre>}
        {tab === "webhook" && <pre className={styles.code}>{webhookSnippet()}</pre>}
        {tab === "review" && (
          <ul className={styles.findings}>
            {FINDINGS.map((f) => (
              <li key={f.rule}>
                <code>{f.rule}</code>
                <span>{f.title}</span>
                <em>Caught before it can run, fixed with Apply Fix</em>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
