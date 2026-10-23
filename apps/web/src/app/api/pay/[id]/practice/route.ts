import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { BizError } from "@/lib/biz/business";
import { rasMode } from "@/lib/biz/ras";
import { handle, readJson } from "@/lib/biz/route";
import { getInvoice } from "@/lib/biz/store";
import { handleRasEvent } from "@/lib/biz/webhooks";

/**
 * Practice mode only: the buyer "pays" and Roqqu's payment_link_completed
 * event is simulated through the real webhook handler.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    if (rasMode() !== "practice") throw new BizError("Simulated payments only exist in Practice mode.", 403);
    const invoice = await getInvoice((await params).id);
    if (!invoice) throw new BizError("Invoice not found.", 404);
    const body = await readJson(req);
    const amount = String(body.amount ?? "");
    if (!/^\d+(\.\d{1,8})?$/.test(amount)) throw new BizError("Missing amount.");
    const outcome = await handleRasEvent({
      event_id: `practice-${randomBytes(8).toString("hex")}`,
      event_type: "payment_link_completed",
      meta_data: {
        payment_reference: invoice.reference,
        amount_received: amount,
        token: "USDT",
        network: "bep20",
        hash: String(body.hash ?? `practice-${randomBytes(8).toString("hex")}`),
        status: "completed",
      },
    });
    return NextResponse.json(outcome);
  });
}
