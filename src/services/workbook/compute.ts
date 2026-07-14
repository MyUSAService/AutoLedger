/**
 * Pure computation layer for the workbook (§3G) — fully unit-testable.
 * Derives Income Statement, Trial Balance and Open Items from classified
 * transactions + balance-sheet inputs. All amounts integer cents.
 */

import { CHART_OF_ACCOUNTS, COA_BY_CODE } from "@/core/chartOfAccounts";

export interface WbTxn {
  id: string;
  date: string; // ISO
  accountLabel: string; // "Chase ****4821"
  rawDescription: string;
  amountCents: number;
  direction: "debit" | "credit";
  categoryCode: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  classifiedBy: "RULE" | "AI" | "STAFF" | null;
  flag: string;
  flagResolved: boolean;
  excludeFromPnl: boolean;
}

export interface BalanceSheetLine {
  categoryCode: string;
  label: string;
  amountCents: number;
  source: "bank statement" | "client questionnaire" | "staff entry" | "computed";
}

export interface ReconProofRow {
  accountLabel: string;
  periodStart: string;
  periodEnd: string;
  openingCents: number;
  creditsCents: number;
  debitsCents: number;
  computedClosingCents: number;
  statedClosingCents: number;
  discrepancyCents: number;
  status: string;
  attempts: number;
}

export interface OpenItem {
  kind: string;
  reference: string;
  description: string;
  severity: "high" | "medium";
}

// ---- Income statement: category × month matrix ----

export interface PnlRow {
  categoryCode: string;
  label: string;
  section: "income" | "expense";
  monthly: number[]; // 12 entries, cents
  totalCents: number;
}

/** Signed P&L amount for a transaction under its category's natural direction. */
export function pnlAmount(txn: WbTxn): number {
  const cat = txn.categoryCode ? COA_BY_CODE.get(txn.categoryCode) : undefined;
  if (!cat) return 0;
  if (cat.section === "income") {
    // income is naturally credit; a debit (e.g. refund) reduces it
    return txn.direction === "credit" ? txn.amountCents : -txn.amountCents;
  }
  if (cat.section === "expense") {
    // expenses naturally debit; a credit (e.g. vendor refund) reduces them
    return txn.direction === "debit" ? txn.amountCents : -txn.amountCents;
  }
  return 0;
}

export function buildPnl(txns: WbTxn[], fiscalYear: number): PnlRow[] {
  const rows = new Map<string, PnlRow>();
  for (const txn of txns) {
    if (txn.excludeFromPnl || !txn.categoryCode) continue;
    const cat = COA_BY_CODE.get(txn.categoryCode);
    if (!cat || (cat.section !== "income" && cat.section !== "expense")) continue;
    let row = rows.get(cat.code);
    if (!row) {
      row = { categoryCode: cat.code, label: cat.name, section: cat.section, monthly: Array(12).fill(0), totalCents: 0 };
      rows.set(cat.code, row);
    }
    const d = new Date(txn.date + "T00:00:00Z");
    if (d.getUTCFullYear() !== fiscalYear) continue;
    const amt = pnlAmount(txn);
    row.monthly[d.getUTCMonth()] += amt;
    row.totalCents += amt;
  }
  // stable order: chart order
  const order = new Map(CHART_OF_ACCOUNTS.map((c, i) => [c.code, i]));
  return [...rows.values()].sort((a, b) => (order.get(a.categoryCode) ?? 999) - (order.get(b.categoryCode) ?? 999));
}

export function netIncomeCents(pnl: PnlRow[]): number {
  const income = pnl.filter((r) => r.section === "income").reduce((s, r) => s + r.totalCents, 0);
  const expense = pnl.filter((r) => r.section === "expense").reduce((s, r) => s + r.totalCents, 0);
  return income - expense;
}

/** "Other Expenses must stay <5% of total — if larger, force review" (§5). */
export function otherExpenseOverflow(pnl: PnlRow[]): boolean {
  const totalExpense = pnl.filter((r) => r.section === "expense").reduce((s, r) => s + r.totalCents, 0);
  const other = pnl.find((r) => r.categoryCode === "EXP_OTHER")?.totalCents ?? 0;
  return totalExpense > 0 && other / totalExpense >= 0.05;
}

// ---- Trial balance ----

export interface TbRow {
  label: string;
  debitCents: number;
  creditCents: number;
}

/**
 * Cash-basis trial balance: assets/expenses debit; liabilities/equity/income credit.
 * Retained Earnings (computed) is the balancing figure — honest, since the chart
 * defines it as computed. Debits ALWAYS equal credits by construction, and the
 * plug amount is visible to the preparer.
 */
export function buildTrialBalance(pnl: PnlRow[], balanceSheet: BalanceSheetLine[]): TbRow[] {
  const rows: TbRow[] = [];
  let debits = 0;
  let credits = 0;
  const push = (label: string, side: "debit" | "credit", cents: number) => {
    if (cents === 0) return;
    // negative on one side flips to the other, keeping all TB figures positive
    if (cents < 0) {
      side = side === "debit" ? "credit" : "debit";
      cents = -cents;
    }
    rows.push({ label, debitCents: side === "debit" ? cents : 0, creditCents: side === "credit" ? cents : 0 });
    if (side === "debit") debits += cents;
    else credits += cents;
  };

  for (const line of balanceSheet) {
    if (line.categoryCode === "EQ_RETAINED") continue; // plug goes last
    const cat = COA_BY_CODE.get(line.categoryCode);
    const side = cat?.section === "asset" ? "debit" : "credit";
    push(line.label, side, line.amountCents);
  }
  for (const row of pnl) {
    push(row.label, row.section === "income" ? "credit" : "debit", row.totalCents);
  }
  push("Retained Earnings (computed)", "credit", debits - credits);
  return rows;
}

// ---- Open items (§3G-7: never hidden, never silently empty) ----

export function buildOpenItems(
  txns: WbTxn[],
  failedDocs: { label: string; discrepancyCents: number }[],
  pnl: PnlRow[],
  unansweredQuestions: string[]
): OpenItem[] {
  const items: OpenItem[] = [];
  for (const doc of failedDocs) {
    items.push({
      kind: "FAILED RECONCILIATION",
      reference: doc.label,
      description: `Statement does not tie — discrepancy of ${(doc.discrepancyCents / 100).toFixed(2)}. Excluded from this workbook.`,
      severity: "high",
    });
  }
  for (const t of txns) {
    if (t.flag !== "NONE" && !t.flagResolved) {
      items.push({
        kind: t.flag,
        reference: `${t.date} · ${t.accountLabel}`,
        description: `${t.rawDescription} — ${(t.amountCents / 100).toFixed(2)} ${t.direction}`,
        severity: t.flag === "LOW_CONFIDENCE" || t.flag === "LARGE_PURCHASE" ? "medium" : "high",
      });
    }
    if (!t.categoryCode && !t.excludeFromPnl && (t.flag === "NONE" || t.flagResolved)) {
      items.push({
        kind: "UNCLASSIFIED",
        reference: `${t.date} · ${t.accountLabel}`,
        description: `${t.rawDescription} — no category assigned`,
        severity: "high",
      });
    }
  }
  if (otherExpenseOverflow(pnl)) {
    items.push({
      kind: "OTHER_EXPENSE_OVERFLOW",
      reference: "Income Statement",
      description: "Other Expenses ≥ 5% of total expenses — review required before filing.",
      severity: "high",
    });
  }
  for (const q of unansweredQuestions) {
    items.push({ kind: "UNANSWERED QUESTION", reference: "Questionnaire", description: q, severity: "medium" });
  }
  return items;
}
