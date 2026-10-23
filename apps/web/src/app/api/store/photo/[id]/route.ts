import { productPhoto } from "@/lib/biz/store";

/** Product photos, served from the database (they are small WebP files). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = /^[0-9a-f-]{36}$/i.test(id) ? await productPhoto(id).catch(() => null) : null;
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.photo), {
    headers: { "content-type": row.photo_type, "cache-control": "public, max-age=86400" },
  });
}
