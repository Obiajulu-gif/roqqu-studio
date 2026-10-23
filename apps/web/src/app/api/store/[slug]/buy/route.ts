import { NextResponse } from "next/server";

import { BizError, getBusinessBySlug } from "@/lib/biz/business";
import { handle, originOf, readJson } from "@/lib/biz/route";
import { buyProduct } from "@/lib/biz/store";

/** A buyer on the public store: one product -> an invoice -> its pay page. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const business = await getBusinessBySlug((await params).slug);
    if (!business) throw new BizError("This store does not exist.", 404);
    const invoice = await buyProduct(business, await readJson(req), originOf(req));
    return NextResponse.json({ pay_url: `/pay/${invoice.id}` }, { status: 201 });
  });
}
