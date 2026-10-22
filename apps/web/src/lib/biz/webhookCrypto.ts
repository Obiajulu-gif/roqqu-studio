/**
 * RAS webhook bodies are `{"hash": "<hex>"}`: AES-256-CTR ciphertext, key = the
 * first 32 characters of our API key, IV = the hex `x-api-key` request header
 * (https://roqqu-api-services.gitbook.io/ras/webhooks/decrypt-webhook-body).
 * A body that does not decrypt to a JSON object is not from Roqqu.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface RasEvent {
  event_id: string;
  event_type: string;
  meta_data: Record<string, unknown>;
  datetime?: string;
}

export function decryptWebhook(hash: string, ivHex: string, apiKey: string): RasEvent | null {
  try {
    const decipher = createDecipheriv("aes-256-ctr", Buffer.from(apiKey.slice(0, 32), "utf8"), Buffer.from(ivHex, "hex"));
    const plain = Buffer.concat([decipher.update(Buffer.from(hash, "hex")), decipher.final()]).toString("utf8");
    const event = JSON.parse(plain) as RasEvent;
    return event && typeof event === "object" && typeof event.event_type === "string" ? event : null;
  } catch {
    return null;
  }
}

/** The way RAS sends it; Practice mode and tests use this. */
export function encryptWebhook(event: RasEvent, apiKey: string): { body: { hash: string }; iv: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-ctr", Buffer.from(apiKey.slice(0, 32), "utf8"), iv);
  const hash = Buffer.concat([cipher.update(JSON.stringify(event), "utf8"), cipher.final()]).toString("hex");
  return { body: { hash }, iv: iv.toString("hex") };
}
