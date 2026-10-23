import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";

import { PayNow } from "@/components/pay/PayNow";
import { formatNaira } from "@/lib/biz/money";
import { rasMode } from "@/lib/biz/ras";
import { ensureFreshLink, getInvoice, invoiceForPayer } from "@/lib/biz/store";

import "../../public.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Invoice · Roqqu Studio" };

async function origin() {
  const h = await headers();
  return process.env.PUBLIC_APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export default async function PayPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await getInvoice((await params).id).catch(() => null);
  if (!found) notFound();
  const invoice = await ensureFreshLink(found, await origin()).catch(() => found);
  const view = await invoiceForPayer(invoice);
  const bep20 = invoice.link_wallets.find((w) => w.network === "bep20")?.address ?? null;

  return (
    <div className="pub">
      <main className="pp">
        <header className="pp-head">
          <p className="pp-from">Invoice from</p>
          <h1>{view.business.name}</h1>
          <p className="pp-owner">{view.business.owner}</p>
        </header>

        <section className="pp-card" aria-label={`Invoice ${invoice.number}`}>
          <div className="pp-meta">
            <div>
              <span>Invoice</span>
              <b>{invoice.number}</b>
            </div>
            <div>
              <span>Billed to</span>
              <b>{invoice.customer_name}</b>
            </div>
            <div>
              <span>Date</span>
              <b>{new Date(invoice.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</b>
            </div>
          </div>

          <table className="pp-items">
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {invoice.items.map((it, i) => (
                <tr key={i}>
                  <td>{it.description}</td>
                  <td>{it.quantity}</td>
                  <td>{formatNaira(Number(it.unit_ngn) * it.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pp-total">
            <span>Total</span>
            <b>{formatNaira(invoice.total_ngn)}</b>
          </div>
          <p className="pp-rate">≈ {view.usdt_due} USDT at Roqqu&apos;s rate of ₦{view.ngn_per_usd.toLocaleString("en-NG")} per dollar</p>

          <PayNow
            invoiceId={invoice.id}
            usdtDue={view.usdt_due}
            bep20Address={bep20}
            otherWallets={invoice.link_wallets.filter((w) => w.network !== "bep20")}
            hostedLink={invoice.link_url}
            initialStatus={invoice.status}
            mode={rasMode()}
          />

          {view.settles_to ? (
            <p className="pp-settle">
              Settles to {view.business.name}&apos;s Roqqu wallet <code>{view.settles_to.slice(0, 8)}…{view.settles_to.slice(-6)}</code>
            </p>
          ) : null}
        </section>

        <footer className="pp-foot">
          <Link href={`/s/${view.business.slug}`}>Visit {view.business.name}&apos;s store</Link>
          <span>
            <Image src="/figma/roqqu-logo.svg" alt="" width={16} height={16} /> Payments confirmed by Roqqu
          </span>
        </footer>
      </main>
    </div>
  );
}
