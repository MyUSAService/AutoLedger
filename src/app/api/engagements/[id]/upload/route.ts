import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { storage, sha256, documentKey } from "@/services/storage";
import { enqueue } from "@/services/queue";
import { triggerJobProcessing } from "@/services/jobTrigger";
import { requireStaff, AuthError } from "@/lib/auth";

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB per statement

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireStaff();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  const { id: engagementId } = await params;
  const engagement = await db.engagement.findUnique({ where: { id: engagementId } });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.status === "RELEASED")
    return NextResponse.json({ error: "Engagement is released — reopen it before uploading" }, { status: 409 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.type !== "application/pdf")
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 415 });
  if (file.size > MAX_SIZE)
    return NextResponse.json({ error: "File too large (max 25 MB)" }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  // basic magic-byte check — a PDF must start with %PDF
  if (!buf.subarray(0, 5).toString("latin1").startsWith("%PDF"))
    return NextResponse.json({ error: "File is not a valid PDF" }, { status: 415 });

  const sha = sha256(buf);
  const existing = await db.statementDocument.findUnique({
    where: { engagementId_fileSha256: { engagementId, fileSha256: sha } },
  });
  if (existing)
    return NextResponse.json({ error: `Duplicate: this exact file was already uploaded (${existing.originalFilename})` }, { status: 409 });

  // naive page count: count /Type /Page occurrences (good enough for chunking hints)
  const pageCount = Math.max(1, (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length);

  const key = documentKey(engagementId, sha, file.name);
  await storage().put(key, buf, "application/pdf");

  const doc = await db.statementDocument.create({
    data: {
      engagementId,
      originalFilename: file.name,
      storageKey: key,
      fileSha256: sha,
      pageCount,
      status: "UPLOADED",
    },
  });
  await db.auditLog.create({
    data: { entity: "StatementDocument", entityId: doc.id, action: "uploaded", detailJson: JSON.stringify({ filename: file.name, size: file.size }) },
  });

  const jobId = await enqueue("process_statement", { documentId: doc.id });
  await triggerJobProcessing();
  return NextResponse.json({ documentId: doc.id, jobId });
}
