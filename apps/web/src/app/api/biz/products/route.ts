import { NextResponse } from "next/server";

import { handle, readJson, requireBusiness } from "@/lib/biz/route";
import { createProduct, listProducts } from "@/lib/biz/store";

export async function GET() {
  return handle(async () => NextResponse.json({ products: await listProducts((await requireBusiness()).id) }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const business = await requireBusiness();
    return NextResponse.json({ product: await createProduct(business.id, await readJson(req)) }, { status: 201 });
  });
}
