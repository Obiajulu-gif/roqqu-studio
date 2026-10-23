import { NextResponse } from "next/server";

import { handle, originOf, readJson, requireBusiness } from "@/lib/biz/route";
import { createInvoice, listInvoices } from "@/lib/biz/store";

export async function GET() {
  return handle(async () => NextResponse.json({ invoices: await listInvoices((await requireBusiness()).id) }));
}

/** A new invoice with its own Roqqu payment link. */
export async function POST(req: Request) {
  return handle(async () => {
    const business = await requireBusiness();
    const invoice = await createInvoice(business, await readJson(req), originOf(req));
    return NextResponse.json({ invoice, pay_url: `${originOf(req)}/pay/${invoice.id}` }, { status: 201 });
  });
}
