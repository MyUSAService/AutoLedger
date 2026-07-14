import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/services/queue";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const engagement = await db.engagement.findUnique({ where: { id } });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });

  const staff = await db.user.findFirst({ where: { role: "STAFF" } });
  if (!staff) return NextResponse.json({ error: "No staff user seeded" }, { status: 500 });

  await db.engagement.update({ where: { id }, data: { status: "IN_REVIEW" } });
  const jobId = await enqueue("generate_workbook", { engagementId: id, generatedByUserId: staff.id });

  await db.reviewAction.create({
    data: { engagementId: id, userId: staff.id, action: "release", toValue: `job:${jobId}` },
  });
  return NextResponse.json({ jobId });
}
