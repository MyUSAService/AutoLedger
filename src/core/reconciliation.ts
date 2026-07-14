/**
 * Reconciliation gate — the NON-NEGOTIABLE arithmetic integrity check (§3C).
 *
 * For every statement: opening + sum(credits) − sum(debits) MUST equal closing,
 * to the cent. Unreconciled data NEVER flows downstream.
 *
 * Pure functions, no I/O — fully unit-testable.
 */

export interface ExtractedLine {
  date: string; // ISO yyyy-mm-dd
  description: string;
  amountCents: number; // always positive
  direction: "debit" | "credit";
  runningBalanceCents?: number | null;
}

export interface StatementForRecon {
  openingBalanceCents: number;
  closingBalanceCents: number;
  lines: ExtractedLine[];
}

export interface ReconciliationProof {
  openingBalanceCents: number;
  sumCreditsCents: number;
  sumDebitsCents: number;
  computedClosingCents: number;
  statedClosingCents: number;
  discrepancyCents: number; // computed − stated; 0 = tie
  ties: boolean;
  /** Human-readable arithmetic, stored for the audit trail. */
  formula: string;
}

export function reconcile(stmt: StatementForRecon): ReconciliationProof {
  let sumCredits = 0;
  let sumDebits = 0;
  for (const line of stmt.lines) {
    if (!Number.isInteger(line.amountCents) || line.amountCents < 0) {
      throw new Error(
        `Invalid amountCents ${line.amountCents} for line "${line.description}" — amounts must be non-negative integer cents`
      );
    }
    if (line.direction === "credit") sumCredits += line.amountCents;
    else sumDebits += line.amountCents;
  }
  const computed = stmt.openingBalanceCents + sumCredits - sumDebits;
  const discrepancy = computed - stmt.closingBalanceCents;
  return {
    openingBalanceCents: stmt.openingBalanceCents,
    sumCreditsCents: sumCredits,
    sumDebitsCents: sumDebits,
    computedClosingCents: computed,
    statedClosingCents: stmt.closingBalanceCents,
    discrepancyCents: discrepancy,
    ties: discrepancy === 0,
    formula: `${fmt(stmt.openingBalanceCents)} + ${fmt(sumCredits)} - ${fmt(sumDebits)} = ${fmt(computed)} (stated closing: ${fmt(stmt.closingBalanceCents)}, discrepancy: ${fmt(discrepancy)})`,
  };
}

/**
 * Secondary check: if running balances are present, walk the ledger and find
 * the FIRST line where the running balance breaks. Localizes extraction errors
 * so the corrective retry prompt can point at the exact spot.
 */
export interface RunningBalanceBreak {
  index: number;
  line: ExtractedLine;
  expectedCents: number;
  statedCents: number;
}

export function findRunningBalanceBreaks(stmt: StatementForRecon): RunningBalanceBreak[] {
  const breaks: RunningBalanceBreak[] = [];
  let balance = stmt.openingBalanceCents;
  stmt.lines.forEach((line, index) => {
    balance += line.direction === "credit" ? line.amountCents : -line.amountCents;
    if (line.runningBalanceCents != null && line.runningBalanceCents !== balance) {
      breaks.push({ index, line, expectedCents: balance, statedCents: line.runningBalanceCents });
      // Re-anchor to the stated balance so each break is reported once,
      // instead of cascading through the rest of the statement.
      balance = line.runningBalanceCents;
    }
  });
  return breaks;
}

/**
 * Month-over-month continuity (§3C): closing of period N must equal opening of
 * period N+1 for the same account. Also detects gaps in coverage.
 */
export interface PeriodSummary {
  documentId: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  openingBalanceCents: number;
  closingBalanceCents: number;
}

export type ContinuityIssue =
  | { kind: "balance_discontinuity"; prev: PeriodSummary; next: PeriodSummary; differenceCents: number }
  | { kind: "coverage_gap"; prev: PeriodSummary; next: PeriodSummary; gapDays: number }
  | { kind: "overlap"; prev: PeriodSummary; next: PeriodSummary };

export function checkContinuity(periods: PeriodSummary[]): ContinuityIssue[] {
  const sorted = [...periods].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const issues: ContinuityIssue[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    const prevEnd = new Date(prev.periodEnd + "T00:00:00Z").getTime();
    const nextStart = new Date(next.periodStart + "T00:00:00Z").getTime();
    const dayMs = 86_400_000;
    const gapDays = Math.round((nextStart - prevEnd) / dayMs) - 1;

    if (nextStart <= prevEnd) {
      issues.push({ kind: "overlap", prev, next });
    } else if (gapDays > 0) {
      issues.push({ kind: "coverage_gap", prev, next, gapDays });
    }
    if (prev.closingBalanceCents !== next.openingBalanceCents) {
      issues.push({
        kind: "balance_discontinuity",
        prev,
        next,
        differenceCents: next.openingBalanceCents - prev.closingBalanceCents,
      });
    }
  }
  return issues;
}

/** Months (yyyy-mm) covered vs. missing across a fiscal year for the coverage calendar. */
export function coverageCalendar(
  periods: { periodStart: string; periodEnd: string }[],
  fiscalYear: number
): { month: string; covered: boolean }[] {
  const covered = new Set<string>();
  for (const p of periods) {
    const start = new Date(p.periodStart + "T00:00:00Z");
    const end = new Date(p.periodEnd + "T00:00:00Z");
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cursor <= end) {
      covered.add(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${fiscalYear}-${String(i + 1).padStart(2, "0")}`;
    return { month, covered: covered.has(month) };
  });
}

function fmt(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
