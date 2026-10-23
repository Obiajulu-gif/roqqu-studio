import { NextResponse } from "next/server";

import { getInvoice } from "@/lib/biz/store";

/** Public status poll for the pay page: only what the payer can already see. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const invoice = await getInvoice((await params).id).catch(() => null);
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return NextResponse.json({
    status: invoice.status,
    paid_token: invoice.paid_token,
    paid_amount: invoice.paid_amount,
    paid_at: invoice.paid_at,
  });
}
