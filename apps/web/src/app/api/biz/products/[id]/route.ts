import { NextResponse } from "next/server";

import { BizError } from "@/lib/biz/business";
import { handle, readJson, requireBusiness } from "@/lib/biz/route";
import { deleteProduct, setProductActive } from "@/lib/biz/store";

type Ctx = { params: Promise<{ id: string }> };

/** Show or hide a product on the store. */
export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    const business = await requireBusiness();
    const product = await setProductActive(business.id, (await params).id, Boolean((await readJson(req)).active));
    if (!product) throw new BizError("Product not found.", 404);
    return NextResponse.json({ product });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    const business = await requireBusiness();
    if (!(await deleteProduct(business.id, (await params).id))) throw new BizError("Product not found.", 404);
    return NextResponse.json({ ok: true });
  });
}
