import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { BizError, getWallets } from "@/lib/biz/business";
import { rasMode } from "@/lib/biz/ras";
import { handle, readJson, requireBusiness } from "@/lib/biz/route";
import { handleRasEvent } from "@/lib/biz/webhooks";

/**
 * Practice mode only: pretend someone sent coins to one of the business's
 * wallets, through the same webhook handler a real Roqqu deposit uses.
 */
export async function POST(req: Request) {
  return handle(async () => {
    if (rasMode() !== "practice") throw new BizError("Practice deposits only exist in Practice mode.", 403);
    const business = await requireBusiness();
    const body = await readJson(req);
    const wallet = (await getWallets(business.id)).find((w) => w.network === body.network);
    if (!wallet) throw new BizError("Pick one of your wallets.");
    const value = String(body.amount ?? "");
    if (!/^\d+(\.\d{1,8})?$/.test(value) || Number(value) <= 0) throw new BizError("Enter an amount greater than 0.");
    const outcome = await handleRasEvent({
      event_id: `practice-${randomBytes(8).toString("hex")}`,
      event_type: "token_received",
      meta_data: { address: wallet.address, network: wallet.network, token: wallet.token, value, hash: `practice-${randomBytes(8).toString("hex")}`, status: "confirmed" },
    });
    return NextResponse.json(outcome);
  });
}
