import { NextResponse } from "next/server";

import { consumeLoginToken } from "@/lib/biz/business";
import { originOf } from "@/lib/biz/route";
import { setSessionCookie } from "@/lib/biz/session";

/** The link from the sign-in email: sign in, then go to the business. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const businessId = await consumeLoginToken(token).catch(() => null);
  if (!businessId) {
    return NextResponse.redirect(`${originOf(req)}/studio/business?signin=expired`, 303);
  }
  await setSessionCookie(businessId);
  return NextResponse.redirect(`${originOf(req)}/studio/business`, 303);
}
