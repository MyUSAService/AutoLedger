import { describe, it, expect } from "vitest";
import {
  reconcile,
  findRunningBalanceBreaks,
  checkContinuity,
  coverageCalendar,
  type StatementForRecon,
  type PeriodSummary,
} from "./reconciliation";
import { parseCents, formatCents, formatUsd } from "./money";

describe("parseCents", () => {
  it("parses plain decimals", () => {
    expect(parseCents("1234.56")).toBe(123456);
    expect(parseCents("0.01")).toBe(1);
    expect(parseCents("100")).toBe(10000);
  });
  it("parses thousands separators and symbols", () => {
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents(" 12,000.00 ")).toBe(1200000);
  });
  it("parses negatives and accounting parentheses", () => {
    expect(parseCents("-45.00")).toBe(-4500);
    expect(parseCents("(45.00)")).toBe(-4500);
  });
  it("parses single decimal digit", () => {
    expect(parseCents("3.5")).toBe(350);
  });
  it("throws on garbage", () => {
    expect(() => parseCents("abc")).toThrow();
    expect(() => parseCents("1.234.5")).toThrow();
    expect(() => parseCents("12.345")).toThrow(); // 3 decimals is ambiguous
  });
});

describe("formatCents / formatUsd", () => {
  it("formats", () => {
    expect(formatCents(123456)).toBe("1,234.56");
    expect(formatCents(-4500)).toBe("-45.00");
    expect(formatCents(0)).toBe("0.00");
    expect(formatUsd(-4500)).toBe("-$45.00");
  });
  it("handles bigint", () => {
    expect(formatCents(123456789012n)).toBe("1,234,567,890.12");
  });
});

describe("reconcile — the gate", () => {
  const base: StatementForRecon = {
    openingBalanceCents: 100000, // $1,000.00
    closingBalanceCents: 125000, // $1,250.00
    lines: [
      { date: "2025-01-05", description: "STRIPE PAYOUT", amountCents: 50000, direction: "credit" },
      { date: "2025-01-10", description: "RENT", amountCents: 25000, direction: "debit" },
    ],
  };

  it("ties to the cent when arithmetic is exact", () => {
    const proof = reconcile(base);
    expect(proof.ties).toBe(true);
    expect(proof.discrepancyCents).toBe(0);
    expect(proof.sumCreditsCents).toBe(50000);
    expect(proof.sumDebitsCents).toBe(25000);
    expect(proof.computedClosingCents).toBe(125000);
  });

  it("fails on a one-cent discrepancy — no tolerance", () => {
    const proof = reconcile({ ...base, closingBalanceCents: 125001 });
    expect(proof.ties).toBe(false);
    expect(proof.discrepancyCents).toBe(-1);
  });

  it("detects a missing transaction", () => {
    const proof = reconcile({ ...base, lines: base.lines.slice(0, 1) });
    expect(proof.ties).toBe(false);
    expect(proof.discrepancyCents).toBe(25000); // the missing $250 debit
  });

  it("handles empty statement (no activity)", () => {
    const proof = reconcile({ openingBalanceCents: 5000, closingBalanceCents: 5000, lines: [] });
    expect(proof.ties).toBe(true);
  });

  it("handles negative balances (overdraft)", () => {
    const proof = reconcile({
      openingBalanceCents: -10000,
      closingBalanceCents: -5000,
      lines: [{ date: "2025-02-01", description: "DEPOSIT", amountCents: 5000, direction: "credit" }],
    });
    expect(proof.ties).toBe(true);
  });

  it("rejects non-integer or negative line amounts", () => {
    expect(() =>
      reconcile({ ...base, lines: [{ date: "2025-01-01", description: "X", amountCents: 10.5, direction: "debit" }] })
    ).toThrow(/integer cents/);
    expect(() =>
      reconcile({ ...base, lines: [{ date: "2025-01-01", description: "X", amountCents: -100, direction: "debit" }] })
    ).toThrow(/integer cents/);
  });

  it("stores a human-readable formula for the audit trail", () => {
    const proof = reconcile(base);
    expect(proof.formula).toContain("1000.00 + 500.00 - 250.00 = 1250.00");
  });
});

describe("findRunningBalanceBreaks — error localization", () => {
  it("finds no breaks in a consistent ledger", () => {
    const stmt: StatementForRecon = {
      openingBalanceCents: 10000,
      closingBalanceCents: 12000,
      lines: [
        { date: "2025-01-02", description: "A", amountCents: 5000, direction: "credit", runningBalanceCents: 15000 },
        { date: "2025-01-03", description: "B", amountCents: 3000, direction: "debit", runningBalanceCents: 12000 },
      ],
    };
    expect(findRunningBalanceBreaks(stmt)).toHaveLength(0);
  });

  it("localizes the first broken line and re-anchors", () => {
    const stmt: StatementForRecon = {
      openingBalanceCents: 10000,
      closingBalanceCents: 12000,
      lines: [
        // extraction misread this amount: stated running balance implies $60 credit, not $50
        { date: "2025-01-02", description: "A", amountCents: 5000, direction: "credit", runningBalanceCents: 16000 },
        { date: "2025-01-03", description: "B", amountCents: 4000, direction: "debit", runningBalanceCents: 12000 },
      ],
    };
    const breaks = findRunningBalanceBreaks(stmt);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].index).toBe(0);
    expect(breaks[0].expectedCents).toBe(15000);
    expect(breaks[0].statedCents).toBe(16000);
  });
});

describe("checkContinuity — month-over-month", () => {
  const jan: PeriodSummary = {
    documentId: "d1", periodStart: "2025-01-01", periodEnd: "2025-01-31",
    openingBalanceCents: 100000, closingBalanceCents: 150000,
  };
  const feb: PeriodSummary = {
    documentId: "d2", periodStart: "2025-02-01", periodEnd: "2025-02-28",
    openingBalanceCents: 150000, closingBalanceCents: 130000,
  };

  it("passes clean consecutive months", () => {
    expect(checkContinuity([jan, feb])).toHaveLength(0);
  });

  it("sorts input — order does not matter", () => {
    expect(checkContinuity([feb, jan])).toHaveLength(0);
  });

  it("flags balance discontinuity (likely missing statement)", () => {
    const badFeb = { ...feb, openingBalanceCents: 140000 };
    const issues = checkContinuity([jan, badFeb]);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("balance_discontinuity");
    if (issues[0].kind === "balance_discontinuity") {
      expect(issues[0].differenceCents).toBe(-10000);
    }
  });

  it("flags a coverage gap (skipped month)", () => {
    const mar: PeriodSummary = {
      documentId: "d3", periodStart: "2025-03-01", periodEnd: "2025-03-31",
      openingBalanceCents: 150000, closingBalanceCents: 160000,
    };
    const issues = checkContinuity([jan, mar]);
    expect(issues.some((i) => i.kind === "coverage_gap")).toBe(true);
  });

  it("flags overlapping periods (duplicate-ish upload)", () => {
    const janDup: PeriodSummary = {
      documentId: "d4", periodStart: "2025-01-15", periodEnd: "2025-02-14",
      openingBalanceCents: 120000, closingBalanceCents: 150000,
    };
    const issues = checkContinuity([jan, janDup]);
    expect(issues.some((i) => i.kind === "overlap")).toBe(true);
  });
});

describe("coverageCalendar", () => {
  it("marks covered and missing months", () => {
    const cal = coverageCalendar(
      [
        { periodStart: "2025-01-01", periodEnd: "2025-01-31" },
        { periodStart: "2025-02-01", periodEnd: "2025-03-31" }, // two-month statement
      ],
      2025
    );
    expect(cal).toHaveLength(12);
    expect(cal[0]).toEqual({ month: "2025-01", covered: true });
    expect(cal[2]).toEqual({ month: "2025-03", covered: true });
    expect(cal[3]).toEqual({ month: "2025-04", covered: false });
    expect(cal.filter((m) => m.covered)).toHaveLength(3);
  });
});
