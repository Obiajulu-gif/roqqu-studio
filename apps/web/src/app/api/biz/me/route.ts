import { NextResponse } from "next/server";

import { balances, getWallets, recentLedger } from "@/lib/biz/business";
import { emailConfigured } from "@/lib/biz/email";
import { NETWORKS, rasMode } from "@/lib/biz/ras";
import { handle, requireBusiness } from "@/lib/biz/route";
import { dailyCapUsd, recentSends } from "@/lib/biz/sends";

/** Everything the business dashboard shows: who, wallets, balances, activity. */
export async function GET() {
  return handle(async () => {
    const business = await requireBusiness();
    const [wallets, bal, ledger, sends] = await Promise.all([
      getWallets(business.id),
      balances(business.id),
      recentLedger(business.id),
      recentSends(business.id),
    ]);
    return NextResponse.json({
      business,
      wallets: wallets.map((w) => ({ ...w, label: NETWORKS.find((n) => n.network === w.network)?.label ?? w.network })),
      balances: bal,
      ledger,
      sends,
      mode: rasMode(),
      email_configured: emailConfigured(),
      daily_cap_usd: dailyCapUsd(),
    });
  });
}
