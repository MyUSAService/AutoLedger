import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, createStaffCode } from "@/lib/auth";
import { sendMail, staffCodeEmail } from "@/services/email";

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  const valid =
    user &&
    (user.role === "STAFF" || user.role === "ADMIN") &&
    user.passwordHash &&
    verifyPassword(password, user.passwordHash);

  if (!valid) {
    // uniform response time-ish and message — no enumeration
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const code = await createStaffCode(user.id);
  let emailOk = true;
  try {
    await sendMail({ to: user.email, ...staffCodeEmail(code) });
  } catch (e) {
    // Email failure must not lock staff out: surface the code in the
    // function logs (private to the site owner) and tell the UI.
    emailOk = false;
    console.error(`[staff-login] EMAIL SEND FAILED for ${user.email}:`, e);
    console.error(`[staff-login] 2FA code for ${user.email} (email failed, read from logs): ${code}`);
  }
  await db.auditLog.create({
    data: { userId: user.id, entity: "User", entityId: user.id, action: emailOk ? "staff_2fa_code_sent" : "staff_2fa_email_failed" },
  });
  return NextResponse.json({ pending: true, emailOk });
}
