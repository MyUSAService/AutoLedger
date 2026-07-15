import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isValidCategoryCode, COA_BY_CODE } from "@/core/chartOfAccounts";
import { requireStaff, AuthError } from "@/lib/auth";

/** Staff reclassification + optional rule-learning (§3D, §3F). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let staff;
  try {
    staff = await requireStaff();
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    throw e;
  }
  const { id } = await params;
  const body = await req.json();
  const { categoryCode, saveAsRule } = body as { categoryCode: string; saveAsRule?: boolean };

  if (!isValidCategoryCode(categoryCode))
    return NextResponse.json({ error: `Unknown category code: ${categoryCode}` }, { status: 400 });

  const txn = await db.transaction.findUnique({
    where: { id },
    include: { engagement: { include: { client: true } } },
  });
  if (!txn) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  const section = COA_BY_CODE.get(categoryCode)!.section;
  const excludeFromPnl = section !== "income" && section !== "expense";

  await db.transaction.update({
    where: { id },
    data: {
      categoryCode,
      confidence: "HIGH",
      classifiedBy: "STAFF",
      classifierRationale: "Staff reclassification",
      flagResolved: true,
      excludeFromPnl,
    },
  });

  await db.reviewAction.create({
    data: {
      engagementId: txn.engagementId,
      transactionId: id,
      userId: staff.id,
      action: "reclassify",
      fromValue: txn.categoryCode,
      toValue: categoryCode,
    },
  });
  await db.auditLog.create({
    data: {
      userId: staff.id,
      entity: "Transaction",
      entityId: id,
      action: "reclassified",
      detailJson: JSON.stringify({ from: txn.categoryCode, to: categoryCode }),
    },
  });

  // Rule-learning: staff decision becomes a client-specific rule (§3D).
  if (saveAsRule) {
    const pattern = txn.rawDescription.replace(/\d{4,}/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (pattern.length >= 4) {
      await db.classificationRule.create({
        data: {
          clientId: txn.engagement.clientId,
          matchType: "CONTAINS",
          pattern,
          direction: txn.direction,
          categoryCode,
          priority: 50, // client rules beat global starter rules
          createdFromStaffAction: true,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
