/**
 * Transactional email via Resend (magic links, staff 2FA codes).
 * No RESEND_API_KEY → emails are printed to the console (dev mode).
 * Data-flow note: only auth emails — no client financial data leaves via email.
 */

export interface Mail {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Altemore <noreply@altemore.com>",
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

const wrap = (body: string) => `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <div style="font-size:18px;font-weight:700;margin-bottom:16px">Altemore</div>
  ${body}
  <p style="color:#9ca3af;font-size:12px;margin-top:24px">Altemore · Miami, FL</p>
</div>`;

export function magicLinkEmail(link: string, locale: "it" | "en"): { subject: string; html: string } {
  if (locale === "it") {
    return {
      subject: "Il tuo link di accesso — Altemore",
      html: wrap(`
        <p>Clicca il pulsante per accedere al portale documenti. Il link vale per 15 minuti.</p>
        <p><a href="${link}" style="background:#111827;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Accedi al portale</a></p>
        <p style="color:#6b7280;font-size:13px">Se non hai richiesto questo link, ignora questa email.</p>`),
    };
  }
  return {
    subject: "Your sign-in link — Altemore",
    html: wrap(`
      <p>Click the button to sign in to the document portal. The link is valid for 15 minutes.</p>
      <p><a href="${link}" style="background:#111827;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Sign in</a></p>
      <p style="color:#6b7280;font-size:13px">If you didn't request this link, you can ignore this email.</p>`),
  };
}

export function staffCodeEmail(code: string): { subject: string; html: string } {
  return {
    subject: `${code} is your Altemore verification code`,
    html: wrap(`
      <p>Your verification code:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
      <p style="color:#6b7280;font-size:13px">Valid for 10 minutes. If you didn't try to sign in, change your password now.</p>`),
  };
}
