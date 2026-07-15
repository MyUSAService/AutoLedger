import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createMagicLink } from "@/lib/auth";
import { sendMail, magicLinkEmail } from "@/services/email";

export async function POST(req: NextRequest) {
  const { email } = (await req.json()) as { email?: string };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() }, include: { client: true } });
  // Always return ok — no user enumeration.
  if (user && user.role === "CLIENT") {
    // basic rate limit: max 5 links per hour per user
    const recent = await db.loginToken.count({
      where: { userId: user.id, purpose: "MAGIC_LINK", createdAt: { gte: new Date(Date.now() - 3600_000) } },
    });
    if (recent < 5) {
      const raw = await createMagicLink(user.id);
      const link = `${process.env.APP_URL || process.env.URL || "http://localhost:3000"}/api/auth/client/verify?token=${raw}`;
      const locale = (user.client?.language === "en" ? "en" : "it") as "it" | "en";
      await sendMail({ to: user.email, ...magicLinkEmail(link, locale) });
      await db.auditLog.create({
        data: { userId: user.id, entity: "User", entityId: user.id, action: "magic_link_requested" },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
