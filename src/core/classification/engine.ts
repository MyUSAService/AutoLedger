/**
 * Classification orchestrator (§3D).
 *
 * Order of operations per transaction:
 *   1. Special detectors — flags win over everything (never silently guess).
 *   2. Deterministic rules.
 *   3. LLM classification (injected — the engine itself stays pure/testable).
 *
 * Confidence tiers:
 *   HIGH   → auto-classified, still visible in review
 *   MEDIUM → classified but flagged yellow
 *   LOW    → NOT classified; becomes a client question, then staff
 */

import { matchRules, type RuleDef, type TxnForClassification } from "./rules";
import {
  detect,
  matchTransferPairs,
  DEFAULT_DETECTOR_OPTIONS,
  type DetectorOptions,
  type Detection,
} from "./detectors";
import { isValidCategoryCode } from "../chartOfAccounts";

export interface LlmClassification {
  categoryCode: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
}

/** Injected so tests can stub it and the engine never imports the SDK. */
export type LlmClassifier = (
  txns: TxnForClassification[],
  context: { businessType: string | null; entityType: string }
) => Promise<Map<string, LlmClassification>>;

export interface ClassifiedTxn {
  txnId: string;
  categoryCode: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  classifiedBy: "RULE" | "AI" | null;
  ruleId: string | null;
  rationale: string | null;
  flag:
    | "NONE"
    | "LOW_CONFIDENCE"
    | "UNMATCHED_TRANSFER"
    | "OWNER_DEPOSIT"
    | "OWNER_WITHDRAWAL"
    | "LOAN_ACTIVITY"
    | "CREDIT_CARD_PAYMENT"
    | "LARGE_PURCHASE"
    | "TAX_PAYMENT";
  excludeFromPnl: boolean;
  transferPairTxnId: string | null;
}

export interface EngineResult {
  results: Map<string, ClassifiedTxn>;
  transferPairs: { debitTxnId: string; creditTxnId: string; amountCents: number }[];
  stats: {
    total: number;
    byRule: number;
    byAi: number;
    flagged: number;
    transfersExcluded: number;
  };
}

export async function classifyEngagement(
  txns: TxnForClassification[],
  rules: RuleDef[],
  llm: LlmClassifier,
  context: { businessType: string | null; entityType: string },
  detectorOpts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS
): Promise<EngineResult> {
  const results = new Map<string, ClassifiedTxn>();
  const blank = (id: string): ClassifiedTxn => ({
    txnId: id,
    categoryCode: null,
    confidence: null,
    classifiedBy: null,
    ruleId: null,
    rationale: null,
    flag: "NONE",
    excludeFromPnl: false,
    transferPairTxnId: null,
  });

  // ---- 1. Detectors ----
  const detectionsByTxn = new Map<string, Detection[]>();
  for (const txn of txns) {
    detectionsByTxn.set(txn.id, detect(txn, detectorOpts));
  }

  // Transfer pairing runs across the whole engagement, on transfer candidates.
  const transferCandidates = txns.filter((t) =>
    detectionsByTxn.get(t.id)!.some((d) => d.flag === "TRANSFER_CANDIDATE")
  );
  const transferResult = matchTransferPairs(transferCandidates);
  const pairedIds = new Map<string, string>(); // txnId -> partner txnId
  for (const p of transferResult.pairs) {
    pairedIds.set(p.debitTxnId, p.creditTxnId);
    pairedIds.set(p.creditTxnId, p.debitTxnId);
  }
  const unmatchedTransferIds = new Set(transferResult.unmatchedTxnIds);

  const needsLlm: TxnForClassification[] = [];

  for (const txn of txns) {
    const r = blank(txn.id);
    const detections = detectionsByTxn.get(txn.id)!;

    // Matched transfer pair → excluded from P&L, done. (Acceptance criterion 3)
    if (pairedIds.has(txn.id)) {
      r.categoryCode = "NPL_TRANSFER";
      r.confidence = "HIGH";
      r.classifiedBy = "RULE";
      r.rationale = "Matched inter-account transfer pair";
      r.excludeFromPnl = true;
      r.transferPairTxnId = pairedIds.get(txn.id)!;
      results.set(txn.id, r);
      continue;
    }

    // Unmatched transfer → flag, unclassified.
    if (unmatchedTransferIds.has(txn.id)) {
      r.flag = "UNMATCHED_TRANSFER";
      r.rationale = "Transfer-like transaction with no matching pair in uploaded accounts";
      results.set(txn.id, r);
      continue;
    }

    // Owner deposit → NEVER auto-classified as revenue. (Acceptance criterion 4)
    const ownerDeposit = detections.find((d) => d.flag === "OWNER_DEPOSIT");
    if (ownerDeposit) {
      r.flag = "OWNER_DEPOSIT";
      r.categoryCode = "NPL_OWNER_DEPOSIT";
      r.excludeFromPnl = true;
      r.rationale = ownerDeposit.rationale;
      results.set(txn.id, r);
      continue;
    }

    const ownerWithdrawal = detections.find((d) => d.flag === "OWNER_WITHDRAWAL");
    if (ownerWithdrawal) {
      r.flag = "OWNER_WITHDRAWAL";
      r.categoryCode = "NPL_OWNER_WITHDRAWAL";
      r.excludeFromPnl = true;
      r.rationale = ownerWithdrawal.rationale;
      results.set(txn.id, r);
      continue;
    }

    const loan = detections.find((d) => d.flag === "LOAN_ACTIVITY");
    if (loan) {
      r.flag = "LOAN_ACTIVITY";
      r.rationale = loan.rationale; // principal/interest split resolved via questionnaire
      results.set(txn.id, r);
      continue;
    }

    const cc = detections.find((d) => d.flag === "CREDIT_CARD_PAYMENT");
    if (cc) {
      r.flag = "CREDIT_CARD_PAYMENT";
      r.categoryCode = "NPL_CC_PAYMENT";
      r.excludeFromPnl = true;
      r.rationale = cc.rationale;
      results.set(txn.id, r);
      continue;
    }

    // Tax payments: categorize separately, never lumped into generic expenses.
    const tax = detections.find((d) => d.flag === "TAX_PAYMENT");
    if (tax) {
      const ruleMatch = matchRules(txn, rules);
      r.flag = "TAX_PAYMENT";
      r.categoryCode = ruleMatch?.categoryCode ?? "EXP_SALES_TAX";
      r.confidence = ruleMatch ? "HIGH" : "MEDIUM";
      r.classifiedBy = "RULE";
      r.ruleId = ruleMatch?.ruleId ?? null;
      r.rationale = ruleMatch?.rationale ?? tax.rationale;
      results.set(txn.id, r);
      continue;
    }

    // Large purchase: classify normally but keep the flag → questionnaire.
    const large = detections.find((d) => d.flag === "LARGE_PURCHASE");

    // ---- 2. Deterministic rules ----
    const ruleMatch = matchRules(txn, rules);
    if (ruleMatch) {
      r.categoryCode = ruleMatch.categoryCode;
      r.confidence = large ? "MEDIUM" : "HIGH";
      r.classifiedBy = "RULE";
      r.ruleId = ruleMatch.ruleId;
      r.rationale = ruleMatch.rationale;
      if (large) r.flag = "LARGE_PURCHASE";
      results.set(txn.id, r);
      continue;
    }

    // ---- 3. Defer to LLM ----
    if (large) r.flag = "LARGE_PURCHASE";
    results.set(txn.id, r);
    needsLlm.push(txn);
  }

  // ---- LLM pass (batched) ----
  if (needsLlm.length > 0) {
    const llmResults = await llm(needsLlm, context);
    for (const txn of needsLlm) {
      const r = results.get(txn.id)!;
      const ai = llmResults.get(txn.id);
      if (!ai || !isValidCategoryCode(ai.categoryCode) || ai.confidence === "low") {
        // LOW/invalid → NOT classified. Flag for client question / staff. Never guess.
        r.categoryCode = null;
        r.confidence = "LOW";
        r.classifiedBy = null;
        r.flag = r.flag === "NONE" ? "LOW_CONFIDENCE" : r.flag;
        r.rationale = ai?.rationale ?? "Model returned no usable classification";
      } else {
        r.categoryCode = ai.categoryCode;
        r.confidence = ai.confidence === "high" ? "HIGH" : "MEDIUM";
        r.classifiedBy = "AI";
        r.rationale = ai.rationale;
      }
    }
  }

  const all = [...results.values()];
  return {
    results,
    transferPairs: transferResult.pairs,
    stats: {
      total: txns.length,
      byRule: all.filter((r) => r.classifiedBy === "RULE").length,
      byAi: all.filter((r) => r.classifiedBy === "AI").length,
      flagged: all.filter((r) => r.flag !== "NONE").length,
      transfersExcluded: transferResult.pairs.length * 2,
    },
  };
}
