import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireClient, AuthError } from "@/lib/auth";
import { getCurrentEngagement } from "@/services/clientPortal";
import { storage, sha256, documentKey } from "@/services/storage";
import { enqueue } from "@/services/queue";
import { triggerJobProcessing } from "@/services/jobTrigger";
import { getLocale } from "@/lib/locale";
import { t } from "@/i18n";

const MAX_SIZE = 25 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 30; // rate limiting (§ security)

export async function POST(req: NextRequest) {
  try {
    const user = await requireClient();
    const engagement = await getCurrentEngagement(user.clientId);
    if (!engagement) return NextResponse.json({ error: "no_engagement" }, { status: 404 });
    const locale = await getLocale(engagement.client.language);

    if (engagement.status === "RELEASED")
      return NextResponse.json({ error: t(locale, "common.error") }, { status: 409 });

    const recent = await db.statementDocument.count({
      where: { engagementId: engagement.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    });
    if (recent >= MAX_UPLOADS_PER_HOUR)
      return NextResponse.json({ error: t(locale, "common.error") }, { status: 429 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: t(locale, "common.error") }, { status: 400 });
    if (file.type !== "application/pdf")
      return NextResponse.json({ error: t(locale, "upload.notPdf") }, { status: 415 });
    if (file.size > MAX_SIZE)
      return NextResponse.json({ error: t(locale, "upload.tooLarge") }, { status: 413 });

    const buf = Buffer.from(await file.arrayBuffer());
    if (!buf.subarray(0, 5).toString("latin1").startsWith("%PDF"))
      return NextResponse.json({ error: t(locale, "upload.notPdf") }, { status: 415 });

    const sha = sha256(buf);
    const existing = await db.statementDocument.findUnique({
      where: { engagementId_fileSha256: { engagementId: engagement.id, fileSha256: sha } },
    });
    if (existing) return NextResponse.json({ error: t(locale, "upload.duplicate") }, { status: 409 });

    const pageCount = Math.max(1, (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length);
    const key = documentKey(engagement.id, sha, file.name);
    await storage().put(key, buf, "application/pdf");

    const doc = await db.statementDocument.create({
      data: {
        engagementId: engagement.id,
        originalFilename: file.name,
        storageKey: key,
        fileSha256: sha,
        pageCount,
        status: "UPLOADED",
      },
    });
    await db.auditLog.create({
      data: {
        userId: user.id,
        entity: "StatementDocument",
        entityId: doc.id,
        action: "uploaded_by_client",
        detailJson: JSON.stringify({ filename: file.name, size: file.size }),
      },
    });
    const jobId = await enqueue("process_statement", { documentId: doc.id });
    await triggerJobProcessing();
    return NextResponse.json({ documentId: doc.id, jobId });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
}
