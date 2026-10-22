/** Shared plumbing for the /api/biz route handlers. */
import { NextResponse } from "next/server";

import { BizError, getBusiness, type Business } from "./business";
import { DbMissing } from "./db";
import { RasError } from "./ras";
import { currentBusinessId } from "./session";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Run a handler; turn known errors into clean JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BizError) return fail(err.message, err.status);
    if (err instanceof DbMissing) return fail(err.message, 503);
    if (err instanceof RasError) return fail(`Roqqu: ${err.message}`, 502);
    console.error(err);
    return fail("Something went wrong on our side. Try again.", 500);
  }
}

/** The signed-in business, or a 401 thrown as a BizError. */
export async function requireBusiness(): Promise<Business> {
  const id = await currentBusinessId();
  const business = id ? await getBusiness(id) : null;
  if (!business) throw new BizError("Sign in to your business first.", 401);
  return business;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new BizError("Send a JSON body.");
  }
}

/** The public origin for links in emails and payment-link redirects. */
export function originOf(req: Request): string {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
