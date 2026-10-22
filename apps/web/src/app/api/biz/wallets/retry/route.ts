import { NextResponse } from "next/server";

import { setupWallets } from "@/lib/biz/business";
import { handle, requireBusiness } from "@/lib/biz/route";

/** "Retry wallet setup": create whichever wallets are still missing. */
export async function POST() {
  return handle(async () => NextResponse.json({ business: await setupWallets(await requireBusiness()) }));
}
