/**
 * Pipeline orchestration: upload → extract → validate → reconcile → classify.
 * Runs inside the worker for the "process_statement" job type.
 * Errors are LOUD and LOCALIZED: every failure path sets an explicit
 * document status + reason. Nothing unreconciled flows downstream.
 */

import { db } from "@/lib/db";
import { storage } from "./storage";
import { extractStatement, toReconInput } from "./extraction/extractor";
import { validateStatementAnchors } from "./extraction/schema";
import { anthropicPdfClient, anthropicClassifier } from "./anthropic";
import { classifyEngagement } from "@/core/classification/engine";
import { GLOBAL_STARTER_RULES, type RuleDef, type TxnForClassification } from "@/core/classification/rules";
import { parseCents } from "@/core/money";
import { reportProgress } from "./queue";

export async function processStatementJob(jobId: string, payload: { documentId: string }) {
  const doc = await db.statementDocument.findUniqueOrThrow({
    where: { id: payload.documentId },
    include: { engagement: { include: { client: true } } },
  });

  await db.statementDocument.update({ where: { id: doc.id }, data: { status: "EXTRACTING" } });
  await reportProgress(jobId, 10, "Extracting statement…");

  const pdf = await storage().get(doc.storageKey);
  const outcome = await extractStatement(anthropicPdfClient(), pdf.toString("base64"), {
    pageCount: doc.pageCount ?? 1,
  });

  // Log every model call for auditability.
  for (const log of outcome.logs) {
    await db.extractionCall.create({
      data: {
        documentId: doc.id,
        purpose: log.purpose,
        model: log.model,
        promptVersion: log.promptVersion,
        pageRange: log.pageRange,
        rawResponse: log.rawResponse,
        inputTokens: log.inputTokens,
        outputTokens: log.outputTokens,
      },
    });
  }

  if (outcome.status === "invalid_json") {
    console.error(`[pipeline] extraction invalid_json for doc ${doc.id}:`, outcome.error);
    await db.statementDocument.update({
      where: { id: doc.id },
      data: { status: "REJECTED", rejectionReason: "Extraction produced unreadable output. Staff attention required." },
    });
    await audit("StatementDocument", doc.id, "extraction_invalid_json", { error: outcome.error });
    return;
  }

  // Step-A anchor validation → plain-language rejection.
  const anchors = validateStatementAnchors(outcome.result);
  if (!anchors.ok) {
    await db.statementDocument.update({
      where: { id: doc.id },
      data: {
        status: "REJECTED",
        rejectionReason: doc.engagement.client.language === "it" ? anchors.reasonIt : anchors.reasonEn,
      },
    });
    await audit("StatementDocument", doc.id, "rejected_missing_anchors", {});
    return;
  }

  const r = outcome.result;
  await reportProgress(jobId, 40, "Reconciling…");

  // Upsert account (masked last4 only).
  const account = await db.account.upsert({
    where: {
      engagementId_bankName_last4: {
        engagementId: doc.engagementId,
        bankName: r.bank_name ?? "Unknown Bank",
        last4: r.account_last4!,
      },
    },
    create: {
      engagementId: doc.engagementId,
      bankName: r.bank_name ?? "Unknown Bank",
      last4: r.account_last4!,
      accountType: r.account_type === "savings" ? "SAVINGS" : r.account_type === "credit_card" ? "CREDIT_CARD" : "CHECKING",
      currency: r.currency ?? "USD",
    },
    update: {},
  });

  // Duplicate period check (same account + same period).
  const dupe = await db.statementDocument.findFirst({
    where: {
      engagementId: doc.engagementId,
      accountId: account.id,
      periodStart: new Date(r.period_start!),
      periodEnd: new Date(r.period_end!),
      id: { not: doc.id },
      status: { in: ["RECONCILED", "CLASSIFIED"] },
    },
  });
  if (dupe) {
    await db.statementDocument.update({
      where: { id: doc.id },
      data: { status: "DUPLICATE", accountId: account.id, rejectionReason: "A statement for this account and period was already processed." },
    });
    return;
  }

  const proof = outcome.proof;
  const reconData = {
    accountId: account.id,
    periodStart: new Date(r.period_start!),
    periodEnd: new Date(r.period_end!),
    openingBalanceCents: BigInt(parseCents(r.opening_balance!)),
    closingBalanceCents: BigInt(parseCents(r.closing_balance!)),
    reconSumCreditsCents: BigInt(proof.sumCreditsCents),
    reconSumDebitsCents: BigInt(proof.sumDebitsCents),
    reconComputedClosingCents: BigInt(proof.computedClosingCents),
    reconDiscrepancyCents: BigInt(proof.discrepancyCents),
    reconAttempts: outcome.attempts,
  };

  if (outcome.status === "failed_reconciliation") {
    // LOUD failure → staff queue. Never flows downstream. (Acceptance criterion 2)
    await db.statementDocument.update({
      where: { id: doc.id },
      data: { ...reconData, status: "FAILED_RECONCILIATION" },
    });
    await audit("StatementDocument", doc.id, "failed_reconciliation", { formula: proof.formula });
    return;
  }

  // ---- Reconciled: persist transactions ----
  await db.statementDocument.update({
    where: { id: doc.id },
    data: { ...reconData, status: "RECONCILED", reconciledAt: new Date() },
  });
  await audit("StatementDocument", doc.id, "reconciled", { formula: proof.formula, attempts: outcome.attempts });

  const recon = toReconInput(r);
  await db.transaction.deleteMany({ where: { documentId: doc.id } }); // idempotent reprocessing
  await db.transaction.createMany({
    data: recon.lines.map((l) => ({
      engagementId: doc.engagementId,
      accountId: account.id,
      documentId: doc.id,
      date: new Date(l.date),
      rawDescription: l.description,
      amountCents: BigInt(l.amountCents),
      direction: l.direction === "credit" ? ("CREDIT" as const) : ("DEBIT" as const),
      runningBalanceCents: l.runningBalanceCents != null ? BigInt(l.runningBalanceCents) : null,
    })),
  });

  // ---- Classification across the WHOLE engagement (transfer pairing needs all accounts) ----
  await reportProgress(jobId, 70, "Classifying transactions…");
  await classifyEngagementTransactions(doc.engagementId);

  await db.statementDocument.update({ where: { id: doc.id }, data: { status: "CLASSIFIED" } });
  await reportProgress(jobId, 95, "Done");
}

export async function classifyEngagementTransactions(engagementId: string) {
  const engagement = await db.engagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: { client: true },
  });

  // Only reclassify transactions staff hasn't touched.
  const txns = await db.transaction.findMany({
    where: { engagementId, classifiedBy: { not: "STAFF" } },
  });
  if (txns.length === 0) return;

  const clientRules = await db.classificationRule.findMany({
    where: { active: true, OR: [{ clientId: engagement.clientId }, { clientId: null }] },
  });
  const rules: RuleDef[] = [
    ...clientRules.map((r) => ({
      id: r.id,
      matchType: r.matchType,
      pattern: r.pattern,
      direction: r.direction === "DEBIT" ? ("debit" as const) : r.direction === "CREDIT" ? ("credit" as const) : null,
      categoryCode: r.categoryCode,
      priority: r.priority,
    })),
    ...GLOBAL_STARTER_RULES,
  ];

  const input: TxnForClassification[] = txns.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    rawDescription: t.rawDescription,
    amountCents: Number(t.amountCents),
    direction: t.direction === "CREDIT" ? "credit" : "debit",
    accountId: t.accountId,
  }));

  const threshold = Number(process.env.LARGE_PURCHASE_THRESHOLD_CENTS ?? 250_000);
  const result = await classifyEngagement(
    input,
    rules,
    anthropicClassifier(),
    { businessType: engagement.client.businessType, entityType: engagement.client.entityType },
    { largePurchaseThresholdCents: threshold }
  );

  for (const [txnId, c] of result.results) {
    await db.transaction.update({
      where: { id: txnId },
      data: {
        categoryCode: c.categoryCode,
        confidence: c.confidence,
        classifiedBy: c.classifiedBy,
        ruleId: c.ruleId && !c.ruleId.startsWith("g-") ? c.ruleId : null,
        classifierRationale: c.rationale,
        flag: c.flag,
        excludeFromPnl: c.excludeFromPnl,
        transferPairId: c.transferPairTxnId,
      },
    });
  }
}

async function audit(entity: string, entityId: string, action: string, detail: Record<string, unknown>) {
  await db.auditLog.create({
    data: { entity, entityId, action, detailJson: JSON.stringify(detail) },
  });
}
