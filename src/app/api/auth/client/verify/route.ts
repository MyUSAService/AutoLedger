import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink, createSession, setSessionCookie } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = process.env.APP_URL || process.env.URL || "http://localhost:3000";
  if (!token) return NextResponse.redirect(`${base}/login?error=invalid`);

  const user = await consumeMagicLink(token);
  if (!user || user.role !== "CLIENT") {
    return NextResponse.redirect(`${base}/login?error=invalid`);
  }
  const raw = await createSession(user.id);
  await setSessionCookie(raw);
  await db.auditLog.create({
    data: { userId: user.id, entity: "User", entityId: user.id, action: "client_login" },
  });
  return NextResponse.redirect(`${base}/client`);
}
