/**
 * Business sign-in: a signed, httpOnly cookie holding the business id. No
 * passwords: onboarding signs the owner in, and another device signs in with
 * an emailed one-time link.
 */
import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "rs_biz";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (32+ random characters) in production");
  }
  return new TextEncoder().encode("dev-only-session-secret-change-me-0123456789");
}

export async function signSession(businessId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(businessId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(businessId: string) {
  (await cookies()).set(SESSION_COOKIE, await signSession(businessId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in business id, or null. */
export async function currentBusinessId(): Promise<string | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** A random token and the hash we store (the raw token only ever goes to the email). */
export function newSecretToken(bytes = 24): { raw: string; hash: string } {
  const raw = randomBytes(bytes).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** A 6-digit code and its hash, salted with the send id so codes are not reusable. */
export function newCode(salt: string): { code: string; hash: string } {
  const code = String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, "0");
  return { code, hash: hashToken(`${salt}:${code}`) };
}
