import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";

import { BuyButton } from "@/components/pay/BuyButton";
import { getBusinessBySlug } from "@/lib/biz/business";
import { formatNaira } from "@/lib/biz/money";
import { listProducts } from "@/lib/biz/store";

import "../../public.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const business = await getBusinessBySlug((await params).slug).catch(() => null);
  return { title: business ? `${business.business_name} · Store` : "Store" };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug).catch(() => null);
  if (!business) notFound();
  const products = await listProducts(business.id, true);

  return (
    <div className="pub">
      <main className="st">
        <header className="st-head">
          <h1>{business.business_name}</h1>
          <p>Run by {business.owner_name}. Pay in USDT or BTC; every order is confirmed by Roqqu.</p>
        </header>

        {products.length === 0 ? (
          <p className="st-empty">Nothing for sale yet. Check back soon.</p>
        ) : (
          <ul className="st-grid">
            {products.map((p) => (
              <li key={p.id} className="st-item">
                <div className="st-photo">
                  {p.has_photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/store/photo/${p.id}`} alt={p.name} loading="lazy" />
                  ) : (
                    <span aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div className="st-body">
                  <h2>{p.name}</h2>
                  {p.description ? <p>{p.description}</p> : null}
                  <b>{formatNaira(p.price_ngn)}</b>
                  <BuyButton slug={business.slug} productId={p.id} productName={p.name} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="pp-foot">
          <span>
            <Image src="/figma/roqqu-logo.svg" alt="" width={16} height={16} /> Payments confirmed by Roqqu
          </span>
        </footer>
      </main>
    </div>
  );
}
