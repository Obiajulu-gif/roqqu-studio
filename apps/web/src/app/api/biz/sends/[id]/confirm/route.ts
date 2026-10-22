import { NextResponse } from "next/server";

import { handle, readJson, requireBusiness } from "@/lib/biz/route";
import { confirmSend } from "@/lib/biz/sends";

/** Step 2 of a send: the right code debits the balance and queues it on Roqqu. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const business = await requireBusiness();
    const { id } = await params;
    const send = await confirmSend(business.id, id, String((await readJson(req)).code ?? ""));
    return NextResponse.json({ send });
  });
}
