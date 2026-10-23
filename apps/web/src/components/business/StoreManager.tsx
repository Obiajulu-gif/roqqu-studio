/**
 * The seller's store: add products with a photo and a naira price, share one
 * link. Photos are shrunk in the browser to WebP (max 1200px, under 200 KB)
 * before upload, so the database stays small.
 */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useMe } from "./useBusiness";

interface Product {
  id: string;
  name: string;
  description: string;
  price_ngn: string;
  has_photo: boolean;
  active: boolean;
}

const naira = (v: string | number) => `₦${Number(v).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const MAX_BYTES = 200 * 1024;

/** Resize to fit 1200px and re-encode as WebP, stepping quality down until it fits. */
async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    if (blob && blob.size <= MAX_BYTES) {
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
    }
  }
  throw new Error("That photo is too detailed to fit 200 KB. Try a smaller one.");
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function StoreManager() {
  const me = useMe();
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState({ name: "", price_ngn: "", description: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const storeUrl = typeof window === "undefined" ? `/s/${me.business.slug}` : `${window.location.origin}/s/${me.business.slug}`;

  const load = useCallback(async () => {
    const res = await call<{ products: Product[] }>("/api/biz/products", "GET").catch(() => ({ products: [] }));
    setProducts(res.products);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickPhoto(file: File | undefined) {
    setError(null);
    if (!file) return setPhoto(null);
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that photo");
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call("/api/biz/products", "POST", { ...form, photo });
      setForm({ name: "", price_ngn: "", description: "" });
      setPhoto(null);
      (e.target as HTMLFormElement).reset();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the product");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: Product) {
    await call(`/api/biz/products/${p.id}`, "PATCH", { active: !p.active }).catch((err) => setError(String(err.message)));
    await load();
  }

  async function remove(p: Product) {
    if (!window.confirm(`Delete “${p.name}”? Past invoices for it are kept.`)) return;
    await call(`/api/biz/products/${p.id}`, "DELETE").catch((err) => setError(String(err.message)));
    await load();
  }

  return (
    <div className="sm">
      <section className="sm-share">
        <div>
          <b>Your store link</b>
          <code>{storeUrl}</code>
        </div>
        <div className="svc-row">
          <button type="button" className="svc-btn" onClick={() => void navigator.clipboard.writeText(storeUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}>
            {copied ? "Copied" : "Copy link"}
          </button>
          <a className="svc-btn svc-btn--primary" href={`/s/${me.business.slug}`} target="_blank" rel="noopener noreferrer">Open store</a>
        </div>
      </section>

      <form className="svc-card sm-form" onSubmit={add}>
        <h3>Add a product</h3>
        <div className="sm-form__grid">
          <label className="sm-drop">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="Product preview" />
            ) : (
              <span>Add a photo<small>JPG, PNG or WebP</small></span>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
          </label>
          <div className="sm-fields">
            <label className="svc-field">
              <span>Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jollof rice tray" required minLength={2} maxLength={80} />
            </label>
            <label className="svc-field">
              <span>Price (₦)</span>
              <input inputMode="decimal" value={form.price_ngn} onChange={(e) => setForm({ ...form, price_ngn: e.target.value })} placeholder="12500" required />
            </label>
            <label className="svc-field">
              <span>Description (optional)</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Serves 10" maxLength={500} />
            </label>
          </div>
        </div>
        <button className="svc-btn svc-btn--primary" disabled={busy}>{busy ? "Adding…" : "Add to store"}</button>
        {error ? <div className="svc-notice is-bad" role="alert">{error}</div> : null}
      </form>

      {products.length === 0 ? (
        <p className="svc-empty">No products yet. Add your first one above; it appears on your store right away.</p>
      ) : (
        <ul className="sm-list">
          {products.map((p) => (
            <li key={p.id} className={p.active ? "" : "is-hidden"}>
              <div className="sm-thumb">
                {p.has_photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/store/photo/${p.id}`} alt="" />
                ) : (
                  <span aria-hidden>{p.name.slice(0, 1)}</span>
                )}
              </div>
              <div className="sm-info">
                <b>{p.name}</b>
                <span>{naira(p.price_ngn)}{p.active ? "" : " · hidden from the store"}</span>
              </div>
              <button type="button" className="svc-link" onClick={() => void toggle(p)}>{p.active ? "Hide" : "Show"}</button>
              <button type="button" className="svc-link" onClick={() => void remove(p)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
