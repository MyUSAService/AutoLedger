import { describe, it, expect } from "vitest";
import {
  buildPnl,
  buildTrialBalance,
  buildOpenItems,
  netIncomeCents,
  otherExpenseOverflow,
  pnlAmount,
  type WbTxn,
  type BalanceSheetLine,
} from "./compute";

const t = (o: Partial<WbTxn> & { id: string }): WbTxn => ({
  date: "2025-03-15",
  accountLabel: "Chase ****4821",
  rawDescription: "TEST",
  amountCents: 10000,
  direction: "debit",
  categoryCode: "EXP_RENT",
  confidence: "HIGH",
  classifiedBy: "RULE",
  flag: "NONE",
  flagResolved: false,
  excludeFromPnl: false,
  ...o,
});

describe("pnlAmount — natural direction signs", () => {
  it("income credit positive, income debit (refund) negative", () => {
    expect(pnlAmount(t({ id: "1", categoryCode: "INC_SALES", direction: "credit" }))).toBe(10000);
    expect(pnlAmount(t({ id: "2", categoryCode: "INC_SALES", direction: "debit" }))).toBe(-10000);
  });
  it("expense debit positive, expense credit (vendor refund) negative", () => {
    expect(pnlAmount(t({ id: "1", direction: "debit" }))).toBe(10000);
    expect(pnlAmount(t({ id: "2", direction: "credit" }))).toBe(-10000);
  });
  it("non-P&L categories contribute zero", () => {
    expect(pnlAmount(t({ id: "1", categoryCode: "NPL_TRANSFER" }))).toBe(0);
  });
});

describe("buildPnl", () => {
  it("aggregates by category and month, excluding non-P&L", () => {
    const pnl = buildPnl(
      [
        t({ id: "1", categoryCode: "INC_SALES", direction: "credit", amountCents: 100000, date: "2025-01-10" }),
        t({ id: "2", categoryCode: "INC_SALES", direction: "credit", amountCents: 50000, date: "2025-02-10" }),
        t({ id: "3", categoryCode: "EXP_RENT", amountCents: 30000, date: "2025-01-05" }),
        t({ id: "4", categoryCode: "NPL_TRANSFER", excludeFromPnl: true, amountCents: 999999 }),
        t({ id: "5", categoryCode: null, amountCents: 12345 }), // unclassified never hits P&L
      ],
      2025
    );
    const sales = pnl.find((r) => r.categoryCode === "INC_SALES")!;
    expect(sales.monthly[0]).toBe(100000);
    expect(sales.monthly[1]).toBe(50000);
    expect(sales.totalCents).toBe(150000);
    expect(pnl.find((r) => r.categoryCode === "NPL_TRANSFER")).toBeUndefined();
    expect(netIncomeCents(pnl)).toBe(120000);
  });

  it("ignores transactions outside the fiscal year", () => {
    const pnl = buildPnl([t({ id: "1", categoryCode: "EXP_RENT", date: "2024-12-31" })], 2025);
    expect(pnl.find((r) => r.categoryCode === "EXP_RENT")?.totalCents ?? 0).toBe(0);
  });
});

describe("buildTrialBalance — debits ALWAYS equal credits", () => {
  const bs: BalanceSheetLine[] = [
    { categoryCode: "BS_CASH", label: "Cash — Chase ****4821", amountCents: 500000, source: "bank statement" },
    { categoryCode: "BS_LOANS_PAYABLE", label: "Loans Payable", amountCents: 200000, source: "client questionnaire" },
    { categoryCode: "EQ_OWNER_CAPITAL", label: "Owner Capital", amountCents: 100000, source: "client questionnaire" },
  ];

  it("balances with the retained earnings plug (acceptance criterion 5)", () => {
    const pnl = buildPnl(
      [
        t({ id: "1", categoryCode: "INC_SALES", direction: "credit", amountCents: 400000, date: "2025-06-01" }),
        t({ id: "2", categoryCode: "EXP_RENT", amountCents: 150000, date: "2025-06-05" }),
      ],
      2025
    );
    const tb = buildTrialBalance(pnl, bs);
    const debits = tb.reduce((s, r) => s + r.debitCents, 0);
    const credits = tb.reduce((s, r) => s + r.creditCents, 0);
    expect(debits).toBe(credits);
    expect(tb.some((r) => r.label.includes("Retained Earnings"))).toBe(true);
  });

  it("negative amounts flip sides instead of printing negatives", () => {
    const tb = buildTrialBalance([], [
      { categoryCode: "BS_CASH", label: "Cash (overdrawn)", amountCents: -50000, source: "bank statement" },
    ]);
    const cash = tb.find((r) => r.label.includes("overdrawn"))!;
    expect(cash.creditCents).toBe(50000);
    expect(cash.debitCents).toBe(0);
    const debits = tb.reduce((s, r) => s + r.debitCents, 0);
    const credits = tb.reduce((s, r) => s + r.creditCents, 0);
    expect(debits).toBe(credits);
  });
});

describe("otherExpenseOverflow — the <5% rule", () => {
  it("flags when Other Expenses ≥ 5%", () => {
    const pnl = buildPnl(
      [
        t({ id: "1", categoryCode: "EXP_RENT", amountCents: 90000, date: "2025-04-01" }),
        t({ id: "2", categoryCode: "EXP_OTHER", amountCents: 10000, date: "2025-04-01" }),
      ],
      2025
    );
    expect(otherExpenseOverflow(pnl)).toBe(true);
  });
  it("passes when under 5%", () => {
    const pnl = buildPnl(
      [
        t({ id: "1", categoryCode: "EXP_RENT", amountCents: 990000, date: "2025-04-01" }),
        t({ id: "2", categoryCode: "EXP_OTHER", amountCents: 10000, date: "2025-04-01" }),
      ],
      2025
    );
    expect(otherExpenseOverflow(pnl)).toBe(false);
  });
});

describe("buildOpenItems — never silent", () => {
  it("lists failed reconciliations, unresolved flags, and unclassified txns", () => {
    const items = buildOpenItems(
      [
        t({ id: "1", flag: "OWNER_DEPOSIT", flagResolved: false }),
        t({ id: "2", flag: "LARGE_PURCHASE", flagResolved: true }), // resolved → not listed as flag
        t({ id: "3", categoryCode: null, flag: "NONE" }), // unclassified
      ],
      [{ label: "chase_jan.pdf", discrepancyCents: -1500 }],
      [],
      ["Did the business buy equipment this year?"]
    );
    expect(items.some((i) => i.kind === "FAILED RECONCILIATION")).toBe(true);
    expect(items.some((i) => i.kind === "OWNER_DEPOSIT")).toBe(true);
    expect(items.some((i) => i.kind === "UNCLASSIFIED")).toBe(true);
    expect(items.some((i) => i.kind === "UNANSWERED QUESTION")).toBe(true);
    expect(items.filter((i) => i.kind === "LARGE_PURCHASE")).toHaveLength(0);
  });

  it("returns empty array when truly clean (sheet then prints explicit NONE row)", () => {
    const items = buildOpenItems([t({ id: "1" })], [], [], []);
    expect(items).toHaveLength(0);
  });
});
