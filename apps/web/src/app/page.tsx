import { Bricolage_Grotesque, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import styles from "./landing.module.css";
import { UnderTheHood } from "./UnderTheHood";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"] });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--lp-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--lp-mono" });

/* The hero flow: the real blocks of the sell-online template, in order. */
const FLOW = [
  { id: "wallet", x: 30, y: 40, title: "Generate Wallet", type: "roqqu.generate_wallet", cat: "roqqu" },
  { id: "hook", x: 250, y: 40, title: "Deposit webhook", type: "event.payment_webhook", cat: "event" },
  { id: "secret", x: 470, y: 40, title: "Check secret", type: "safety.verify_signature", cat: "safety" },
  { id: "verify", x: 250, y: 170, title: "Get Wallets", type: "roqqu.get_wallets", cat: "roqqu" },
  { id: "amount", x: 470, y: 170, title: "Amount covers total", type: "safety.validate_amount", cat: "safety" },
  { id: "paid", x: 360, y: 290, title: "Mark order paid", type: "app.mark_order_paid", cat: "app" },
];
const WIRES =
  "M190 70 H250 M410 70 H470 M550 100 V130 Q550 150 530 150 H350 Q330 150 330 165 M410 200 H470 M550 230 V255 Q550 270 530 270 H450 Q440 270 440 290";

const ENDPOINTS = [
  "POST /user/generate-wallet",
  "POST /user/wallets",
  "POST /user/send-{token}",
  "GET /prices",
  "POST /user/account-resolve",
  "GET /verify-meter",
  "POST /user/pay-electric",
];

const FAQ = [
  {
    q: "Do I need to write code?",
    a: "No. Business owners pick a template or describe what they sell to Rooky. Developers can use the API playground and the generated code.",
  },
  {
    q: "Which coins can my customers pay with?",
    a: "Bitcoin, Ethereum and Tron. These are the coins Roqqu can create deposit addresses for. The naira total is converted at Roqqu's live coin price.",
  },
  {
    q: "How do you know a customer really paid?",
    a: "Every order gets its own Roqqu address. When Roqqu's webhook arrives, Studio checks its secret, then asks Roqqu how much landed on that address. Screenshots and the webhook alone never mark an order paid.",
  },
  {
    q: "Is there a test mode?",
    a: "Practice mode simulates every step with no keys and no money. Roqqu itself has no sandbox, so live calls move real crypto and stay switched off until you allow them on your server.",
  },
  {
    q: "Does Roqqu Studio hold my money?",
    a: "No. Payments go to your own Roqqu account, using your secret key, which stays on your server and never reaches a browser.",
  },
  {
    q: "What does it cost?",
    a: "The studio is open source. Roqqu charges its own fees for some services, for example BVN and NIN checks and electricity purchases.",
  },
];

const STEPS = [
  { title: "Pick a template", body: "Or tell Rooky what your business does in plain words." },
  { title: "Studio reviews the flow", body: "Payouts that skip verification are blocked before they can run." },
  { title: "Your customer pays in crypto", body: "A fresh Roqqu address, the exact amount and a QR code." },
  { title: "Roqqu confirms it", body: "The order turns paid only after Roqqu shows the coins arrived." },
];

export default function Landing() {
  return (
    <div className={`${styles.page} ${body.variable} ${mono.variable}`}>
      <div className={styles.glow} aria-hidden />

      <nav className={styles.nav} aria-label="Main">
        <Link href="/" className={styles.brand}>
          <Image src="/figma/roqqu-logo.svg" alt="" width={28} height={28} />
          <span className={display.className}>Roqqu Studio</span>
        </Link>
        <div className={styles.navLinks}>
          <a href="#build">What you can build</a>
          <a href="#developers">Developers</a>
          <Link href="/studio/playground">API playground</Link>
          <a href="https://github.com/Obiajulu-gif/roqqu-studio">GitHub</a>
          <Link href="/studio" className={styles.navCta}>
            Get started
          </Link>
        </div>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.pill}>
            <span aria-hidden />
            Built on the Roqqu API
          </p>
          <h1 className={display.className}>Stop trusting screenshots.</h1>
          <p className={styles.lede}>
            Build crypto payment links, invoices, savings groups and bill payments on Roqqu.
            Every order is marked paid only when Roqqu shows the coins in your wallet.
          </p>
          <div className={styles.actions}>
            <Link href="/studio" className={styles.primary}>
              Get started
            </Link>
            <Link href="/studio/playground" className={styles.secondary}>
              Try the Roqqu API
            </Link>
          </div>
          <ul className={styles.coins} aria-label="Coins customers can pay with">
            <li><b>BTC</b> Bitcoin</li>
            <li><b>ETH</b> Ethereum</li>
            <li><b>TRX</b> Tron</li>
          </ul>
        </div>

        <div className={styles.heroVisual}>
        <figure className={styles.window} aria-label="A payment flow in Roqqu Studio">
          <div className={styles.windowBar}>
            <span className={styles.windowTab}>sell-online.flow</span>
            <span className={styles.windowStatus}>
              <i aria-hidden /> Safety review passed
            </span>
          </div>
          <div className={styles.canvas}>
            <svg
              viewBox="0 0 640 360"
              className={styles.graph}
              role="img"
              aria-label="Generate Wallet, deposit webhook, check secret, Get Wallets, amount check, mark order paid"
            >
              <path d={WIRES} className={styles.wire} />
              <path d={WIRES} className={styles.pulse} pathLength={100} />
              {FLOW.map((n) => (
                <g key={n.id} transform={`translate(${n.x} ${n.y})`} className={styles[`node_${n.cat}`]}>
                  <rect width="160" height="60" rx="7" className={styles.nodeBox} />
                  <rect width="3" height="60" rx="1.5" className={styles.nodeStripe} />
                  <text x="16" y="26" className={styles.nodeTitle}>{n.title}</text>
                  <text x="16" y="45" className={styles.nodeType}>{n.type}</text>
                </g>
              ))}
            </svg>
          </div>
        </figure>
          <div className={styles.slip}>
            <div className={styles.slipHead}>
              <span>Order INV-2041</span>
              <b>₦6,000</b>
            </div>
            <p><span className={styles.tick}>✓</span> 16.00 TRX received</p>
            <p className={styles.struck}><span className={styles.cross}>✕</span> <s>Transfer screenshot</s></p>
            <p className={`${styles.stamp} ${display.className}`}>Paid, confirmed by Roqqu</p>
          </div>
        </div>
      </header>

      <section className={styles.endpoints} aria-label="Roqqu API endpoints Studio uses">
        <p>Every block maps to a documented Roqqu endpoint</p>
        <ul>
          {ENDPOINTS.map((e) => (
            <li key={e}><code>{e}</code></li>
          ))}
        </ul>
      </section>

      <section id="build" className={styles.section} aria-labelledby="build-title">
        <h2 id="build-title" className={display.className}>What you can build today</h2>
        <p className={styles.sectionLede}>
          Four vetted templates. Each one passes the safety review before it can take money.
        </p>
        <div className={styles.bento}>
          <article className={`${styles.tile} ${styles.tileWide}`}>
            <div>
              <h3 className={display.className}>Sell goods and services</h3>
              <p>Share one link on WhatsApp. Orders turn green only when the coins land.</p>
            </div>
            <div className={styles.shopMock} aria-hidden>
              <div className={styles.shopLink}>
                <code>pay.roqqu.studio/mama-nkechi</code>
                <span>Copy link</span>
              </div>
              <div className={styles.shopRows}>
                <p><span>Jollof rice tray</span><b>₦12,500</b><em className={styles.ok}>Paid</em></p>
                <p><span>Small chops x2</span><b>₦8,000</b><em className={styles.wait}>Waiting</em></p>
                <p><span>Zobo, 5 litres</span><b>₦4,000</b><em className={styles.ok}>Paid</em></p>
              </div>
            </div>
          </article>
          <article className={styles.tile}>
            <h3 className={display.className}>Send an invoice</h3>
            <p>Bill in naira. Your client pays in BTC, ETH or TRX at Roqqu&apos;s live price.</p>
            <div className={styles.invoiceMock} aria-hidden>
              <p><span>Logo design</span><b>₦150,000</b></p>
              <p className={styles.muted}><span>Pay with</span><b>0.0017 BTC</b></p>
            </div>
          </article>
          <article className={styles.tile}>
            <h3 className={display.className}>Run a savings group</h3>
            <p>Each ajo member gets their own Roqqu wallet. Every contribution is checked.</p>
            <ul className={styles.members} aria-hidden>
              <li><i>AO</i> Ada <em className={styles.ok}>Paid</em></li>
              <li><i>BK</i> Bayo <em className={styles.ok}>Paid</em></li>
              <li><i>CE</i> Chika <em className={styles.wait}>Due Friday</em></li>
            </ul>
          </article>
          <article className={`${styles.tile} ${styles.tileWide}`}>
            <div>
              <h3 className={display.className}>Pay bills</h3>
              <p>Sell electricity units and airtime. The meter is checked by name before money moves.</p>
            </div>
            <div className={styles.meterMock} aria-hidden>
              <p><code>45055844760</code><span>Ikeja Electric, prepaid</span></p>
              <p className={styles.meterOk}>✓ Meter belongs to MRS ADA OKAFOR</p>
              <p><span>Units bought</span><b>₦5,000</b></p>
            </div>
          </article>
        </div>
      </section>

      <section id="developers" className={styles.section} aria-labelledby="dev-title">
        <div className={styles.hoodGrid}>
          <div>
            <h2 id="dev-title" className={display.className}>Every Roqqu endpoint, ready to copy</h2>
            <p className={styles.sectionLede}>
              The API playground covers the whole Roqqu reference. Pick an endpoint, fill the form,
              copy working JavaScript, and send a real request without exposing your key.
            </p>
            <ul className={styles.devList}>
              <li><b>19 endpoints and the deposit webhook</b> from developers.roqqu.com</li>
              <li><b>axios, fetch or roqqu.js</b>, updating as you type</li>
              <li><b>Example responses</b> from the docs, even with no account</li>
              <li><b>roqqu.js</b>: one dependency-free file, one function per endpoint</li>
              <li><b>A safety analyzer</b> that blocks unsafe payment flows, no AI involved</li>
            </ul>
            <Link href="/studio/playground" className={styles.primary}>
              Open the API playground
            </Link>
          </div>
          <UnderTheHood />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="how-title">
        <h2 id="how-title" className={display.className}>How a payment is checked</h2>
        <ol className={styles.steps}>
          {STEPS.map((step) => (
            <li key={step.title}>
              <h3 className={display.className}>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={`${styles.section} ${styles.rooky}`} aria-labelledby="rooky-title">
        <div>
          <h2 id="rooky-title" className={display.className}>Meet Rooky, your setup assistant</h2>
          <p className={styles.sectionLede}>
            Tell Rooky what your business does. Rooky picks a safe template, or builds a new flow
            from Roqqu&apos;s own documentation and refuses anything it cannot make safe.
          </p>
        </div>
        <div className={styles.chat} aria-label="Example chat with Rooky">
          <p className={styles.you}>I sell food on WhatsApp and want customers to pay online.</p>
          <p className={styles.bot}>
            <span aria-hidden>R</span>
            This looks like selling online. Orders are only marked paid after Roqqu confirms the
            money, so fake transfer screenshots never work.
          </p>
          <p className={styles.you}>Build me a rocket to the moon.</p>
          <p className={styles.bot}>
            <span aria-hidden>R</span>
            That isn&apos;t a payment flow I can build. I can set up a shop link, an invoice, a
            savings group or bill payments.
          </p>
        </div>
      </section>

      <section id="faq" className={styles.section} aria-labelledby="faq-title">
        <h2 id="faq-title" className={display.className}>Questions people ask</h2>
        <div className={styles.faq}>
          {FAQ.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.final}>
        <h2 className={display.className}>Your first verified payment flow is a few clicks away.</h2>
        <Link href="/studio" className={styles.primary}>
          Get started
        </Link>
        <p>Practice mode needs no keys and moves no money.</p>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Link href="/" className={styles.brand}>
            <Image src="/figma/roqqu-logo.svg" alt="" width={24} height={24} />
            <span className={display.className}>Roqqu Studio</span>
          </Link>
          <p>
            Built on the Roqqu API. An independent project, not an official Roqqu product.
          </p>
        </div>
        <nav className={styles.footerCols} aria-label="Footer">
          <div>
            <h3>Product</h3>
            <Link href="/studio">Studio</Link>
            <Link href="/studio/playground">API playground</Link>
            <a href="#build">Templates</a>
          </div>
          <div>
            <h3>Resources</h3>
            <a href="https://developers.roqqu.com">Roqqu API docs</a>
            <a href="https://github.com/Obiajulu-gif/roqqu-studio">Source on GitHub</a>
            <a href="#faq">Questions</a>
          </div>
        </nav>
      </footer>
    </div>
  );
}
