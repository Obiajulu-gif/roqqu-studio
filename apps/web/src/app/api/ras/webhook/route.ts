import { NextResponse } from "next/server";

import { webhookKey } from "@/lib/biz/ras";
import { decryptWebhook } from "@/lib/biz/webhookCrypto";
import { handleRasEvent } from "@/lib/biz/webhooks";

/**
 * The one webhook URL to set in the RAS console. Bodies are encrypted with our
 * API key: anything that does not decrypt is not Roqqu and gets a 401. Events
 * that are not about a business (canvas flows) go on to the studio API.
 */
export async function POST(req: Request) {
  const key = webhookKey();
  const iv = req.headers.get("x-api-key") ?? "";
  const raw = await req.text();
  let hash = "";
  try {
    hash = String((JSON.parse(raw) as { hash?: unknown }).hash ?? "");
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const event = key ? decryptWebhook(hash, iv, key) : null;
  if (!event) return NextResponse.json({ error: "does not decrypt with our key" }, { status: 401 });

  try {
    const outcome = await handleRasEvent(event);
    if (!outcome.handled && outcome.reason !== "duplicate") await forwardToStudioApi(raw, iv);
    return NextResponse.json({ received: true, ...outcome });
  } catch (err) {
    // A 5xx makes RAS retry later; the event was not recorded, so the retry is safe.
    console.error("ras.webhook.failed", err);
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

async function forwardToStudioApi(raw: string, iv: string) {
  const origin = process.env.STUDIO_API_ORIGIN || "http://127.0.0.1:8010";
  await fetch(`${origin}/roqqu/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": iv },
    body: raw,
  }).catch(() => undefined);
}
