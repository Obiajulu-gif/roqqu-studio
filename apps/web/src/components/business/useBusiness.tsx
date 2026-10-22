/**
 * Who is signed in to the business workspace, plus their wallets and
 * balances. One fetch of /api/biz/me shared by the shell and every tool page.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface BizWallet {
  network: "bep20" | "trc20" | "bitcoin";
  token: string;
  address: string;
  label: string;
}

export interface BizSend {
  id: string;
  network: string;
  token: string;
  to_address: string;
  amount: string;
  status: string;
  refid: string | null;
  error: string | null;
  created_at: string;
}

export interface BizMe {
  business: {
    id: string;
    slug: string;
    owner_name: string;
    business_name: string;
    email: string;
    wallet_status: "pending" | "ready" | "failed";
    wallet_error: string | null;
  };
  wallets: BizWallet[];
  balances: Record<string, string>;
  ledger: { token: string; amount: string; kind: string; ref: string; created_at: string }[];
  sends: BizSend[];
  mode: "practice" | "test" | "live";
  email_configured: boolean;
  daily_cap_usd: number;
}

type State =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; me: BizMe };

interface Ctx {
  state: State;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const BusinessContext = createContext<Ctx | null>(null);

/** POST JSON to a /api/biz route; throws the server's error message. */
export async function bizPost<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/biz/me", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) setState({ kind: "signed_out" });
      else if (!res.ok) setState({ kind: "unavailable", message: json.error ?? `Error ${res.status}` });
      else setState({ kind: "ready", me: json as BizMe });
    } catch {
      setState({ kind: "unavailable", message: "Could not reach the server." });
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/biz/logout", { method: "POST" });
    setState({ kind: "signed_out" });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <BusinessContext.Provider value={{ state, refresh, signOut }}>{children}</BusinessContext.Provider>;
}

export function useBusiness(): Ctx {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness must be used inside BusinessProvider");
  return ctx;
}

/** The signed-in business; only call below the shell's gate. */
export function useMe(): BizMe {
  const { state } = useBusiness();
  if (state.kind !== "ready") throw new Error("useMe called before sign-in");
  return state.me;
}
