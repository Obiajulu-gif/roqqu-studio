import { NextResponse } from "next/server";

import { devHint, sendMail } from "@/lib/biz/email";
import { handle, readJson, requireBusiness } from "@/lib/biz/route";
import { CODE_MINUTES, startSend } from "@/lib/biz/sends";

/** Step 1 of a send: every check, then a 6-digit code to the owner's email. */
export async function POST(req: Request) {
  return handle(async () => {
    const business = await requireBusiness();
    const { send, code, fee } = await startSend(business.id, await readJson(req));
    const mail = await sendMail(
      business.email,
      `Your code to send ${send.amount} ${send.token.toUpperCase()}: ${code}`,
      `Hi ${business.owner_name},\n\nYour code is ${code}. It confirms sending ${send.amount} ${send.token.toUpperCase()} on ${send.network.toUpperCase()} to:\n${send.to_address}\n\nThe code works for ${CODE_MINUTES} minutes. If you did not start this send, ignore this email and nothing will move.`,
    );
    if (!mail.sent && mail.via !== "none") {
      return NextResponse.json({ error: `We could not email your code (${mail.error}). Try again.` }, { status: 502 });
    }
    return NextResponse.json({ send, fee, email_sent: mail.sent, dev_code: devHint(mail, code) }, { status: 201 });
  });
}
