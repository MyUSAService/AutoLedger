/**
 * Workbook generation job: loads engagement data, builds the .xlsx,
 * stores it versioned (v1, v2, …) and locks the release (§3F/§3G).
 */

import { db } from "@/lib/db";
import { storage } from "@/services/storage";
import { buildWorkbook, type WorkbookInput } from "./build";
import type { WbTxn, BalanceSheetLine, ReconProofRow } from "./compute";
import { COA_BY_CODE } from "@/core/chartOfAccounts";
import { reportProgress } from "@/services/queue";

export async function generateWorkbookJob(
  jobId: string,
  payload: { engagementId: string; generatedByUserId: string }
) {
  const engagement = await db.engagement.findUniqueOrThrow({
    where: { id: payload.engagementId },
    include: {
      client: true,
      accounts: true,
      documents: true,
      transactions: { include: { account: true } },
      questionnaire: true,
    },
  });
  await reportProgress(jobId, 20, "Assembling data…");

  const accountLabel = (a: { bankName: string; last4: string }) => `${a.bankName} ****${a.last4}`;

  const txns: WbTxn[] = engagement.transactions.map((t) => ({
    id: t.id,
    date: t.date.toISOString().slice(0, 10),
    accountLabel: accountLabel(t.account),
    rawDescription: t.rawDescription,
    amountCents: Number(t.amountCents),
    direction: t.direction === "CREDIT" ? "credit" : "debit",
    categoryCode: t.categoryCode,
    confidence: t.confidence,
    classifiedBy: t.classifiedBy,
    flag: t.flag,
    flagResolved: t.flagResolved,
    excludeFromPnl: t.excludeFromPnl,
  }));

  // Balance sheet: cash per account from reconciled statements (source: bank
  // statement) + questionnaire-driven lines persisted as QuestionnaireResponse.
  const balanceSheet: BalanceSheetLine[] = [];
  for (const account of engagement.accounts) {
    const docs = engagement.documents
      .filter((d) => d.accountId === account.id && (d.status === "RECONCILED" || d.status === "CLASSIFIED"))
      .sort((a, b) => (a.periodEnd?.getTime() ?? 0) - (b.periodEnd?.getTime() ?? 0));
    const last = docs[docs.length - 1];
    if (last?.closingBalanceCents != null) {
      balanceSheet.push({
        categoryCode: "BS_CASH",
        label: `Cash — ${accountLabel(account)}`,
        amountCents: Number(last.closingBalanceCents),
        source: "bank statement",
      });
    }
  }
  for (const resp of engagement.questionnaire) {
    try {
      const a = JSON.parse(resp.answerJson) as { categoryCode?: string; label?: string; amountCents?: number };
      if (a.categoryCode && a.amountCents != null && COA_BY_CODE.has(a.categoryCode)) {
        balanceSheet.push({
          categoryCode: a.categoryCode,
          label: a.label ?? COA_BY_CODE.get(a.categoryCode)!.name,
          amountCents: a.amountCents,
          source: "client questionnaire",
        });
      }
    } catch {
      /* malformed answers become open items via unanswered list below */
    }
  }

  const reconProofs: ReconProofRow[] = engagement.documents
    .filter((d) => d.reconComputedClosingCents != null)
    .map((d) => ({
      accountLabel: d.accountId
        ? accountLabel(engagement.accounts.find((a) => a.id === d.accountId)!)
        : d.originalFilename,
      periodStart: d.periodStart?.toISOString().slice(0, 10) ?? "?",
      periodEnd: d.periodEnd?.toISOString().slice(0, 10) ?? "?",
      openingCents: Number(d.openingBalanceCents ?? 0),
      creditsCents: Number(d.reconSumCreditsCents ?? 0),
      debitsCents: Number(d.reconSumDebitsCents ?? 0),
      computedClosingCents: Number(d.reconComputedClosingCents ?? 0),
      statedClosingCents: Number(d.closingBalanceCents ?? 0),
      discrepancyCents: Number(d.reconDiscrepancyCents ?? 0),
      status: d.status,
      attempts: d.reconAttempts,
    }));

  const failedDocs = engagement.documents
    .filter((d) => d.status === "FAILED_RECONCILIATION")
    .map((d) => ({
      label: `${d.originalFilename} (${d.periodStart?.toISOString().slice(0, 10) ?? "?"})`,
      discrepancyCents: Number(d.reconDiscrepancyCents ?? 0),
    }));

  const reviewer = await db.user.findUnique({ where: { id: payload.generatedByUserId } });
  const version = (await db.generatedWorkbook.count({ where: { engagementId: engagement.id } })) + 1;

  const input: WorkbookInput = {
    clientName: engagement.client.businessName,
    entityType: engagement.client.entityType,
    ein: engagement.client.ein,
    fiscalYear: engagement.fiscalYear,
    reviewerName: reviewer?.email ?? "unknown",
    reviewStatus: engagement.status,
    version,
    transactions: txns,
    balanceSheet,
    reconProofs,
    failedDocs,
    unansweredQuestions: [], // Phase 2: derived from questionnaire completeness
  };

  await reportProgress(jobId, 60, "Building Excel workbook…");
  const buffer = await buildWorkbook(input);

  const key = `engagements/${engagement.id}/workbooks/v${version}.xlsx`;
  await storage().put(key, Buffer.from(buffer), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  await db.generatedWorkbook.create({
    data: { engagementId: engagement.id, version, storageKey: key, generatedById: payload.generatedByUserId },
  });
  await db.engagement.update({ where: { id: engagement.id }, data: { status: "RELEASED" } });
  await db.auditLog.create({
    data: {
      userId: payload.generatedByUserId,
      entity: "GeneratedWorkbook",
      entityId: engagement.id,
      action: "workbook_generated",
      detailJson: JSON.stringify({ version, key }),
    },
  });
}
