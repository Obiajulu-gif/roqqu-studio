import { NextResponse } from "next/server";

import { cleanOnboarding, createBusiness, setupWallets } from "@/lib/biz/business";
import { handle, readJson } from "@/lib/biz/route";
import { setSessionCookie } from "@/lib/biz/session";

/** Three fields in, a signed-in business with wallets out. */
export async function POST(req: Request) {
  return handle(async () => {
    const input = cleanOnboarding(await readJson(req));
    const business = await setupWallets(await createBusiness(input));
    await setSessionCookie(business.id);
    return NextResponse.json({ business }, { status: 201 });
  });
}
