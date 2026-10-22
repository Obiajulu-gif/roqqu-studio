/**
 * Money helpers. Naira is handled in kobo (integers) and token amounts as
 * decimal strings, so floating point never decides what someone pays.
 */

/** "1,500.50" / "1500.5" -> 150050 kobo; null when not a positive amount. */
export function toKobo(value: string | number): number | null {
  const text = String(value).replace(/[,\s₦]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const kobo = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return kobo > 0 && Number.isSafeInteger(kobo) ? kobo : null;
}

export const koboToNaira = (kobo: number) => (kobo / 100).toFixed(2);

export function formatNaira(value: string | number): string {
  return `₦${Number(value).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** USDT that covers an NGN amount at `ngnPerUsd`, rounded UP to the cent. */
export function ngnToUsdt(kobo: number, ngnPerUsd: number): string {
  const cents = Math.ceil(kobo / ngnPerUsd - 1e-9);
  return (cents / 100).toFixed(2);
}

/** RAS payment_reference: 1-20 letters and numbers. */
export function paymentReference(prefix: string, random: string): string {
  const ref = (prefix.replace(/[^A-Za-z0-9]/g, "").toUpperCase() + random.replace(/[^A-Za-z0-9]/g, "")).slice(0, 20);
  if (!/^[A-Za-z0-9]{1,20}$/.test(ref)) throw new Error("bad payment reference");
  return ref;
}

/** A store slug from a business name: "Mama Nkechi Foods" -> "mama-nkechi-foods". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "shop";
}

/** Exact decimal compare for token strings ("10.5" >= "10.50"). */
export function decimalGte(a: string, b: string): boolean {
  const scale = 10;
  const big = (v: string) => {
    const [w, f = ""] = v.replace(/^\+/, "").split(".");
    const neg = w.startsWith("-");
    const n = BigInt(w.replace("-", "") + (f + "0".repeat(scale)).slice(0, scale));
    return neg ? -n : n;
  };
  return big(a) >= big(b);
}
