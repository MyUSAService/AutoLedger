import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff, AuthError } from "@/lib/auth";

/**
 * Staff confirms the current classification (often a client-questionnaire
 * proposal) — flag resolved, classification locked as staff-approved.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    const { id } = await params;
    const txn = await db.transaction.findUnique({ where: { id } });
    if (!txn) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await db.transaction.update({
      where: { id },
      data: { flagResolved: true, classifiedBy: txn.categoryCode ? "STAFF" : txn.classifiedBy, confidence: txn.categoryCode ? "HIGH" : txn.confidence },
    });
    await db.reviewAction.create({
      data: {
        engagementId: txn.engagementId,
        transactionId: id,
        userId: staff.id,
        action: "resolve_flag",
        fromValue: txn.flag,
        toValue: txn.categoryCode,
      },
    });
    await db.auditLog.create({
      data: { userId: staff.id, entity: "Transaction", entityId: id, action: "flag_resolved", detailJson: JSON.stringify({ flag: txn.flag, categoryCode: txn.categoryCode }) },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
}
