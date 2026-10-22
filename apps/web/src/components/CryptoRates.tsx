/**
 * Live Roqqu rates + a naira converter for the business dashboard.
 * Backed by GET /roqqu/prices (Roqqu's public /prices, no key needed).
 */
"use client";

import { useEffect, useState } from "react";

import { getJson } from "@/lib/http";

interface RoqquToken {
  symbol: string;
  price_usd: string;
  price_ngn: string;
  change: number | null;
  payable: boolean;
}

interface RoqquPrices {
  ngn_per_usd: string;
  tokens: RoqquToken[];
}

const ngn = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 });

export function CryptoRates() {
  const [prices, setPrices] = useState<RoqquPrices | null>(null);
  const [failed, setFailed] = useState(false);
  const [practice, setPractice] = useState(false);
  const [amount, setAmount] = useState("10000");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await getJson<RoqquPrices>("/roqqu/prices");
        if (alive) {
          setPrices(next);
          setPractice(false);
          setFailed(false);
        }
      } catch {
        // Roqqu unreachable: show the studio's practice prices, clearly labelled.
        try {
          const [board, status] = await Promise.all([
            getJson<{ prices: Record<string, { price: number; change: number }> }>("/services/alerts"),
            getJson<{ ngn_per_usd: string }>("/services/status"),
          ]);
          const rate = Number(status.ngn_per_usd) || 0;
          const tokens = Object.entries(board.prices).map(([symbol, p]) => ({
            symbol,
            price_usd: String(p.price),
            price_ngn: String(p.price * rate),
            change: p.change,
            payable: ["btc", "usdt"].includes(symbol),
          }));
          if (alive) {
            setPrices({ ngn_per_usd: status.ngn_per_usd, tokens });
            setPractice(true);
            setFailed(false);
          }
        } catch {
          if (alive) setFailed(true);
        }
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const payable = prices?.tokens.filter((t) => t.payable) ?? [];
  const naira = Number(amount) || 0;

  return (
    <section className="biz-rates" aria-label="Roqqu rates">
      <header className="biz-rates__head">
        <h2>Roqqu rates</h2>
        <small>Coins your customers can pay with</small>
      </header>
      {failed && <p className="biz-rates__msg">Rates are unavailable right now.</p>}
      {!prices && !failed && <p className="biz-rates__msg">Loading live prices…</p>}
      {payable.length > 0 && (
        <>
          <ul className="biz-rates__list">
            {payable.map((t) => (
              <li key={t.symbol}>
                <strong>{t.symbol.toUpperCase()}</strong>
                <span>₦{ngn.format(Number(t.price_ngn))}</span>
                {t.change !== null && (
                  <em className={t.change >= 0 ? "up" : "down"}>
                    {t.change >= 0 ? "▲" : "▼"} {Math.abs(t.change).toFixed(2)}%
                  </em>
                )}
              </li>
            ))}
          </ul>
          <label className="biz-rates__convert">
            Convert ₦
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
              aria-label="Naira amount"
            />
            <span>
              {payable
                .map((t) => `${(naira / Number(t.price_ngn)).toPrecision(4)} ${t.symbol.toUpperCase()}`)
                .join(" · ")}
            </span>
          </label>
          <small className="biz-rates__note">
            At ₦{ngn.format(Number(prices?.ngn_per_usd))}/USD.{" "}
            {practice
              ? "Roqqu is unreachable, so these are practice prices, not market data."
              : "Prices from Roqqu, refreshed every minute."}
          </small>
        </>
      )}
    </section>
  );
}
