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
  url: 'https://api.roqqu.com/prod/v1/user/generate-wallet',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
    Authorization: \`Bearer \${process.env.ROQQU_SECRET_KEY}\`
  },
  data: {
    token: 'trx'
  }
};

axios
  .request(options)
  .then((res) => console.log(res.data))
  .catch((err) => console.error(err.response?.data ?? err.message));`;

const CLIENT = `// npm needs nothing: roqqu.js is one file from the playground.
const roqqu = require('./roqqu')(process.env.ROQQU_SECRET_KEY);

const { address } = await roqqu.generateWallet({ token: 'trx' });
const price = await roqqu.getPrice({ symbol: 'trx' });
const meter = await roqqu.verifyMeter({
  provider: 'ikeja',
  meter_type: 'prepaid',
  meter_number: '45055844760'
});

console.log(address, price, meter.cust_name);`;

const FINDINGS = [
  { rule: "MON002", title: "Webhook reaches the order without a secret check" },
  { rule: "MON003", title: "No idempotency guard before the order is fulfilled" },
  { rule: "MON004", title: "Amount paid never compared with the invoice total" },
  { rule: "MON011", title: "Payout wallet not validated before Send Token" },
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
