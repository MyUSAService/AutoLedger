import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE } from "@/lib/locale";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { locale } = (await req.json()) as { locale?: string };
  if (locale !== "it" && locale !== "en") return NextResponse.json({ error: "bad_locale" }, { status: 400 });
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const user = await getSessionUser();
  if (user?.clientId) {
    await db.client.update({ where: { id: user.clientId }, data: { language: locale } });
  }
  return NextResponse.json({ ok: true });
}
