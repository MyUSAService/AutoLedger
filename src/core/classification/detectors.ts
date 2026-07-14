/**
 * Special detection logic (§3D) — the classic error sources, treated as
 * first-class features. Pure functions; run BEFORE generic classification
 * so these transactions are routed to questions/flags, never silently guessed.
 */

import type { TxnForClassification } from "./rules";

export type DetectorFlag =
  | "TRANSFER_CANDIDATE"
  | "OWNER_DEPOSIT"
  | "OWNER_WITHDRAWAL"
  | "LOAN_ACTIVITY"
  | "CREDIT_CARD_PAYMENT"
  | "LARGE_PURCHASE"
  | "TAX_PAYMENT";

export interface Detection {
  txnId: string;
  flag: DetectorFlag;
  rationale: string;
}

const RE = {
  transfer: /\b(ONLINE\s+)?TRANSFER\s+(TO|FROM)\b|XFER|INTERNAL\s+TRANSFER|TRANSFER\s+CONF/i,
  ownerDeposit: /\b(OWNER|MEMBER|SHAREHOLDER|CAPITAL)\s*(DEPOSIT|CONTRIBUTION|INVESTMENT)\b|MOBILE\s+DEPOSIT|COUNTER\s+DEPOSIT|CASH\s+DEPOSIT|ZELLE\s+FROM/i,
  ownerWithdrawal: /\b(OWNER|MEMBER)\s*(DRAW|WITHDRAWAL)\b|ATM\s+WITHDRAWAL|CASH\s+WITHDRAWAL|ZELLE\s+TO|CHECK\s*#?\s*\d+/i,
  loan: /\bLOAN\s+(PAYMENT|PMT|PROCEEDS|DISBURSEMENT|ADVANCE)\b|\bSBA\b|KABBAGE|ONDECK|LENDING\s*CLUB|AMEX\s+LOAN/i,
  ccPayment: /\b(CREDIT\s*CARD|CC)\s*(AUTOPAY|PAYMENT|PMT|E-?PAYMENT)\b|CHASE\s+CARD|AMEX\s+EPAYMENT|CAPITAL\s+ONE\s+(CRCARDPMT|PAYMENT|PMT|AUTOPAY)|DISCOVER\s+E-?PAYMENT|BARCLAYCARD|BK\s+OF\s+AMER\s+VISA|CITI\s+(AUTOPAY|PAYMENT)/i,
  tax: /IRS|EFTPS|USATAXPYMT|DEPT\s*(OF\s*)?REV(ENUE)?|FRANCHISE\s+TAX|STATE\s+TAX|SALES\s+TAX/i,
};

export interface DetectorOptions {
  largePurchaseThresholdCents: number; // default 250000 ($2,500)
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  largePurchaseThresholdCents: 250_000,
};

/** Run keyword/pattern detectors on a single transaction. May return multiple detections. */
export function detect(
  txn: TxnForClassification,
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS
): Detection[] {
  const out: Detection[] = [];
  const d = txn.rawDescription;

  if (RE.transfer.test(d)) {
    out.push({ txnId: txn.id, flag: "TRANSFER_CANDIDATE", rationale: "Description matches transfer language" });
  }
  if (RE.tax.test(d)) {
    out.push({ txnId: txn.id, flag: "TAX_PAYMENT", rationale: "Matches tax-authority payment pattern" });
  }
  if (RE.loan.test(d)) {
    out.push({ txnId: txn.id, flag: "LOAN_ACTIVITY", rationale: "Matches loan proceeds/payment pattern" });
  }
  if (txn.direction === "debit" && RE.ccPayment.test(d)) {
    out.push({ txnId: txn.id, flag: "CREDIT_CARD_PAYMENT", rationale: "Looks like a credit card payment — CC statements needed or these expenses are invisible" });
  }
  if (txn.direction === "credit" && RE.ownerDeposit.test(d) && !RE.transfer.test(d)) {
    out.push({ txnId: txn.id, flag: "OWNER_DEPOSIT", rationale: "Deposit pattern that may be owner money — never auto-classified as revenue" });
  }
  if (txn.direction === "debit" && RE.ownerWithdrawal.test(d) && !RE.ccPayment.test(d)) {
    out.push({ txnId: txn.id, flag: "OWNER_WITHDRAWAL", rationale: "Withdrawal pattern that may be an owner draw/distribution" });
  }
  if (
    txn.direction === "debit" &&
    txn.amountCents >= opts.largePurchaseThresholdCents &&
    !RE.transfer.test(d) &&
    !RE.ccPayment.test(d) &&
    !RE.loan.test(d) &&
    !RE.tax.test(d)
  ) {
    out.push({ txnId: txn.id, flag: "LARGE_PURCHASE", rationale: `Debit ≥ threshold — potential fixed asset, routed to questionnaire` });
  }
  return out;
}

/**
 * Inter-account transfer pair matching (§3D): money moving between the
 * client's own uploaded accounts, matched in pairs and excluded from P&L.
 *
 * A pair = debit in account A + credit in account B (different accounts),
 * same amount, dates within `windowDays`. Greedy nearest-date matching.
 * Unmatched transfer-looking transactions are flagged.
 */
export interface TransferMatchResult {
  pairs: { debitTxnId: string; creditTxnId: string; amountCents: number }[];
  unmatchedTxnIds: string[];
}

export function matchTransferPairs(
  candidates: TxnForClassification[],
  windowDays = 3
): TransferMatchResult {
  const debits = candidates.filter((t) => t.direction === "debit");
  const credits = candidates.filter((t) => t.direction === "credit");
  const usedCredits = new Set<string>();
  const pairs: TransferMatchResult["pairs"] = [];

  const dayDiff = (a: string, b: string) =>
    Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86_400_000;

  for (const debit of debits) {
    let best: TxnForClassification | null = null;
    let bestDiff = Infinity;
    for (const credit of credits) {
      if (usedCredits.has(credit.id)) continue;
      if (credit.accountId === debit.accountId) continue; // must be BETWEEN accounts
      if (credit.amountCents !== debit.amountCents) continue;
      const diff = dayDiff(debit.date, credit.date);
      if (diff <= windowDays && diff < bestDiff) {
        best = credit;
        bestDiff = diff;
      }
    }
    if (best) {
      usedCredits.add(best.id);
      pairs.push({ debitTxnId: debit.id, creditTxnId: best.id, amountCents: debit.amountCents });
    }
  }

  const matchedDebits = new Set(pairs.map((p) => p.debitTxnId));
  const unmatchedTxnIds = [
    ...debits.filter((d) => !matchedDebits.has(d.id)).map((d) => d.id),
    ...credits.filter((c) => !usedCredits.has(c.id)).map((c) => c.id),
  ];
  return { pairs, unmatchedTxnIds };
}

/**
 * Loan payment principal/interest split (§3E-3): given loan terms from the
 * questionnaire, compute the split for a fixed monthly payment using simple
 * amortization. Interest = round(balance × annualRate / 12); principal = rest.
 */
export function splitLoanPayment(
  paymentCents: number,
  currentBalanceCents: number,
  annualRatePct: number
): { principalCents: number; interestCents: number } {
  const interest = Math.min(
    paymentCents,
    Math.round((currentBalanceCents * annualRatePct) / 100 / 12)
  );
  return { principalCents: paymentCents - interest, interestCents: interest };
}
