/**
 * Client portal domain service: current engagement, questionnaire assembly
 * from live pipeline flags, and answer persistence with proposed effects.
 */

import { db } from "@/lib/db";
import { buildQuestionnaire, applyAnswer, type Question, type FlaggedTxnInput } from "@/core/questionnaire";
import type { EntityType } from "@/core/chartOfAccounts";

export async function getCurrentEngagement(clientId: string) {
  return db.engagement.findFirst({
    where: { clientId },
    orderBy: { fiscalYear: "desc" },
    include: {
      client: true,
      accounts: true,
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
}

function sellsPhysicalProducts(businessType: string | null): boolean {
  if (!businessType) return true; // unknown → ask; skipping silently loses data
  return /e-?comm|product|retail|shop|store|inventory|merce|negozio|magazzino|food|import/i.test(businessType);
}

const CLIENT_FLAGS = new Set([
  "OWNER_DEPOSIT",
  "OWNER_WITHDRAWAL",
  "LARGE_PURCHASE",
  "CREDIT_CARD_PAYMENT",
  "LOW_CONFIDENCE",
  "UNMATCHED_TRANSFER",
  "LOAN_ACTIVITY",
]);

export async function getQuestionnaireForEngagement(engagementId: string): Promise<Question[]> {
  const engagement = await db.engagement.findUniqueOrThrow({
    where: { id: engagementId },
    include: { client: true },
  });
  const flaggedTxns = await db.transaction.findMany({
    where: { engagementId, flagResolved: false },
    orderBy: { date: "asc" },
  });
  const inputs: FlaggedTxnInput[] = flaggedTxns
    .filter((t) => CLIENT_FLAGS.has(t.flag))
    .map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      description: t.rawDescription,
      amountCents: Number(t.amountCents),
      direction: t.direction === "CREDIT" ? "credit" : "debit",
      flag: t.flag as FlaggedTxnInput["flag"],
    }));

  return buildQuestionnaire({
    entityType: engagement.client.entityType as EntityType,
    sellsPhysicalProducts: sellsPhysicalProducts(engagement.client.businessType),
    flaggedTxns: inputs,
  });
}

export async function getAnswers(engagementId: string): Promise<Record<string, unknown>> {
  const rows = await db.questionnaireResponse.findMany({ where: { engagementId } });
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.section === "balance_sheet") continue; // derived rows, not raw answers
    try {
      out[r.questionKey] = JSON.parse(r.answerJson);
    } catch {
      /* ignore malformed */
    }
  }
  return out;
}

/**
 * Persist an answer + apply its PROPOSED effects.
 * Client answers never resolve staff flags — staff confirms everything (§3E).
 */
export async function saveAnswer(engagementId: string, question: Question, answer: unknown, userId: string) {
  await db.questionnaireResponse.upsert({
    where: {
      engagementId_section_questionKey: {
        engagementId,
        section: question.section,
        questionKey: question.key,
      },
    },
    create: {
      engagementId,
      section: question.section,
      questionKey: question.key,
      answerJson: JSON.stringify(answer),
    },
    update: { answerJson: JSON.stringify(answer), answeredAt: new Date() },
  });

  const effects = applyAnswer(question, answer);
  for (const effect of effects) {
    switch (effect.kind) {
      case "transaction_proposal": {
        const txn = await db.transaction.findFirst({
          where: { id: effect.transactionId, engagementId }, // scope check — never cross-engagement
        });
        if (!txn) break;
        await db.transaction.update({
          where: { id: txn.id },
          data: {
            ...(effect.categoryCode
              ? { categoryCode: effect.categoryCode, excludeFromPnl: effect.excludeFromPnl, confidence: "MEDIUM" }
              : {}),
            classifierRationale: effect.note,
            // flag and flagResolved untouched — staff review is the gate
          },
        });
        break;
      }
      case "balance_sheet_line": {
        await db.questionnaireResponse.upsert({
          where: {
            engagementId_section_questionKey: {
              engagementId,
              section: "balance_sheet",
              questionKey: `bs.${question.key}`,
            },
          },
          create: {
            engagementId,
            section: "balance_sheet",
            questionKey: `bs.${question.key}`,
            answerJson: JSON.stringify({
              categoryCode: effect.categoryCode,
              label: effect.label,
              amountCents: effect.amountCents,
            }),
          },
          update: {
            answerJson: JSON.stringify({
              categoryCode: effect.categoryCode,
              label: effect.label,
              amountCents: effect.amountCents,
            }),
            answeredAt: new Date(),
          },
        });
        break;
      }
      case "info": {
        await db.auditLog.create({
          data: {
            userId,
            entity: "Engagement",
            entityId: engagementId,
            action: "questionnaire_info",
            detailJson: JSON.stringify({ questionKey: question.key, note: effect.note }),
          },
        });
        break;
      }
    }
  }

  await db.auditLog.create({
    data: {
      userId,
      entity: "Engagement",
      entityId: engagementId,
      action: "questionnaire_answered",
      detailJson: JSON.stringify({ questionKey: question.key }),
    },
  });
}
