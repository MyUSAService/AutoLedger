import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/services/queue";
import { requireStaff, AuthError } from "@/lib/auth";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let staff;
  try {
    staff = await requireStaff();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  const { id } = await params;
  const engagement = await db.engagement.findUnique({ where: { id } });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  await db.engagement.update({ where: { id }, data: { status: "IN_REVIEW" } });
  const jobId = await enqueue("generate_workbook", { engagementId: id, generatedByUserId: staff.id });

  await db.reviewAction.create({
    data: { engagementId: id, userId: staff.id, action: "release", toValue: `job:${jobId}` },
  });
  return NextResponse.json({ jobId });
}
