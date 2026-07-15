import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { consumeStaffCode, createSession, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, code } = (await req.json()) as { email?: string; code?: string };
  if (!email || !code) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || (user.role !== "STAFF" && user.role !== "ADMIN")) {
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }
  const ok = await consumeStaffCode(user.id, code.trim());
  if (!ok) return NextResponse.json({ error: "invalid_code" }, { status: 401 });

  const raw = await createSession(user.id);
  await setSessionCookie(raw);
  await db.auditLog.create({
    data: { userId: user.id, entity: "User", entityId: user.id, action: "staff_login" },
  });
  return NextResponse.json({ ok: true });
}
