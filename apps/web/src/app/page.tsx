import { Bricolage_Grotesque } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

import styles from "./landing.module.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["500", "700", "800"] });

const SLIP = [
  { text: "Customer sends 16.00 TRX to your Roqqu address", state: "ok" },
  { text: "Roqqu webhook arrives, secret matches", state: "ok" },
  { text: "Get Wallets shows ₦6,000 received", state: "ok" },
  { text: "Transfer screenshot from the customer", state: "ignored" },
] as const;

const USES = [
  {
    title: "Sell goods and services",
    body: "A shop link you share on WhatsApp. Orders turn green only when the coins land.",
    image: "/figma/templates/template-sell-goods.png",
  },
  {
    title: "Send an invoice",
    body: "Bill a client in naira. They pay in BTC, ETH or TRX at Roqqu's live price.",
    image: "/figma/templates/template-send-invoice.png",
  },
  {
    title: "Run a savings group",
    body: "Every ajo member gets their own Roqqu wallet, and every contribution is checked.",
    image: "/figma/templates/template-ajo.png",
  },
  {
    title: "Pay bills",
    body: "Sell electricity units and airtime. The meter is checked by name before money moves.",
    image: "/figma/templates/template-payments.png",
  },
];

const STEPS = [
  { title: "You pick a template", body: "Or describe your business to Rooky in plain words." },
  { title: "Studio checks the flow", body: "A safety review blocks payouts that skip verification." },
  { title: "Your customer pays in crypto", body: "A fresh Roqqu address and the exact amount, with a QR code." },
  { title: "Roqqu confirms it", body: "The order is marked paid only after Roqqu shows the money arrived." },
];

export default function Landing() {
  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Main">
        <Link href="/" className={styles.brand}>
          <Image src="/figma/roqqu-logo.svg" alt="" width={26} height={26} />
          <span className={display.className}>Roqqu Studio</span>
        </Link>
        <div className={styles.navLinks}>
          <a href="#how">How it works</a>
          <a href="https://github.com/Obiajulu-gif/roqqu-studio">GitHub</a>
          <Link href="/studio" className={styles.navCta}>
            Get started
          </Link>
        </div>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={display.className}>Stop trusting screenshots.</h1>
          <p className={styles.lede}>
            Roqqu Studio turns what you sell into a crypto payment link, invoice or bill-pay
            flow. An order is marked paid only when Roqqu shows the coins in your wallet.
          </p>
          <div className={styles.actions}>
            <Link href="/studio" className={styles.primary}>
              Get started
            </Link>
            <a href="#how" className={styles.secondary}>
              See how a payment is checked
            </a>
          </div>
          <p className={styles.fine}>Free to try. Practice mode needs no keys and moves no money.</p>
        </div>

        <figure className={styles.slip} aria-label="Example payment check">
          <figcaption>
            <span className={display.className}>Order #INV-2041</span>
            <span>₦6,000</span>
          </figcaption>
          <ol>
            {SLIP.map((line, i) => (
              <li
                key={line.text}
                className={line.state === "ok" ? styles.ok : styles.ignored}
                style={{ animationDelay: `${0.35 + i * 0.45}s` }}
              >
                <span aria-hidden>{line.state === "ok" ? "✓" : "✕"}</span>
                <span className={styles.claim}>{line.text}</span>
                {line.state === "ignored" && <em>Not proof of payment</em>}
              </li>
            ))}
          </ol>
          <p className={`${styles.stamp} ${display.className}`}>Paid, confirmed by Roqqu</p>
        </figure>
      </header>

      <section className={styles.coins} aria-label="Accepted coins">
        <p>Customers pay with</p>
        <ul>
          <li>Bitcoin</li>
          <li>Ethereum</li>
          <li>Tron</li>
        </ul>
        <p>through the Roqqu API.</p>
      </section>

      <section className={styles.uses} aria-labelledby="uses-title">
        <h2 id="uses-title" className={display.className}>
          What you can set up today
        </h2>
        <div className={styles.useGrid}>
          {USES.map((use) => (
            <article key={use.title}>
              <Image src={use.image} alt="" width={240} height={150} />
              <h3 className={display.className}>{use.title}</h3>
              <p>{use.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className={styles.how} aria-labelledby="how-title">
        <h2 id="how-title" className={display.className}>
          How a payment is checked
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((step) => (
            <li key={step.title}>
              <h3 className={display.className}>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.rooky} aria-labelledby="rooky-title">
        <div>
          <h2 id="rooky-title" className={display.className}>
            Meet Rooky, your setup assistant
          </h2>
          <p>
            Tell Rooky what your business does. Rooky picks a safe template, or builds a new
            flow from Roqqu&apos;s own documentation and refuses anything it cannot make safe.
          </p>
        </div>
        <div className={styles.chat} aria-label="Example chat with Rooky">
          <p className={styles.you}>I sell food on WhatsApp and want customers to pay online.</p>
          <p className={styles.bot}>
            <span aria-hidden>R</span>
            This looks like selling online. Orders are only marked paid after Roqqu confirms the
            money, so fake transfer screenshots never work.
          </p>
        </div>
      </section>

      <section className={styles.final}>
        <h2 className={display.className}>Set up your first payment flow in minutes.</h2>
        <Link href="/studio" className={styles.primaryLight}>
          Get started
        </Link>
      </section>

      <footer className={styles.footer}>
        <p>
          Built on the <a href="https://developers.roqqu.com">Roqqu API</a>. Roqqu Studio is an
          independent project, not an official Roqqu product.
        </p>
        <a href="https://github.com/Obiajulu-gif/roqqu-studio">Source on GitHub</a>
      </footer>
    </div>
  );
}
