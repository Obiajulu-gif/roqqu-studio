import { NextResponse } from "next/server";

import { createLoginToken } from "@/lib/biz/business";
import { devHint, sendMail } from "@/lib/biz/email";
import { handle, originOf, readJson } from "@/lib/biz/route";

/** Email a one-time sign-in link. Always answers the same, so emails cannot be probed. */
export async function POST(req: Request) {
  return handle(async () => {
    const email = String((await readJson(req)).email ?? "").trim().toLowerCase();
    const token = email ? await createLoginToken(email) : null;
    let dev_link: string | undefined;
    if (token) {
      const link = `${originOf(req)}/api/biz/login/${token.raw}`;
      const mail = await sendMail(
        email,
        `Sign in to ${token.business.business_name} on Roqqu Studio`,
        `Hi ${token.business.owner_name},\n\nOpen this link to sign in (it works once, for 20 minutes):\n${link}\n\nIf you did not ask for this, ignore this email.`,
      );
      dev_link = devHint(mail, link);
    }
    return NextResponse.json({ ok: true, message: "If that email has a business, a sign-in link is on its way.", dev_link });
  });
}
