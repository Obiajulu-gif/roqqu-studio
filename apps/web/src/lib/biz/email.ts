/**
 * Transactional email: Brevo when BREVO_API_KEY is set (free, a single
 * verified sender is enough), else ZeptoMail, else nothing is sent and the
 * caller gets the text back to show in development.
 */

export interface MailResult {
  sent: boolean;
  via: "brevo" | "zeptomail" | "none";
  error?: string;
}

export function emailConfigured(): boolean {
  return !!(process.env.BREVO_API_KEY || process.env.ZEPTOMAIL_API_KEY);
}

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  try {
    if (process.env.BREVO_API_KEY) {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { email: process.env.BREVO_SENDER, name: "Roqqu Studio" },
          to: [{ email: to }],
          subject,
          textContent: text,
        }),
      });
      return res.ok ? { sent: true, via: "brevo" } : { sent: false, via: "brevo", error: `Brevo HTTP ${res.status}` };
    }
    if (process.env.ZEPTOMAIL_API_KEY) {
      const res = await fetch("https://api.zeptomail.com/v1.1/email", {
        method: "POST",
        headers: { Authorization: process.env.ZEPTOMAIL_API_KEY, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          from: { address: process.env.ZEPTOMAIL_SENDER, name: "Roqqu Studio" },
          to: [{ email_address: { address: to } }],
          subject,
          textbody: text,
        }),
      });
      return res.ok ? { sent: true, via: "zeptomail" } : { sent: false, via: "zeptomail", error: `ZeptoMail HTTP ${res.status}` };
    }
  } catch (err) {
    return { sent: false, via: process.env.BREVO_API_KEY ? "brevo" : "zeptomail", error: String(err) };
  }
  console.info(`[email to ${to}] ${subject}\n${text}`);
  return { sent: false, via: "none" };
}

/** In development with no email provider, show the code or link on screen instead. */
export function devHint(result: MailResult, value: string): string | undefined {
  return result.via === "none" && process.env.NODE_ENV !== "production" ? value : undefined;
}
