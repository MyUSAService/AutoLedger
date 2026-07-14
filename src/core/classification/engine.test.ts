import { describe, it, expect } from "vitest";
import { classifyEngagement, type LlmClassifier } from "./engine";
import { matchRules, GLOBAL_STARTER_RULES, type TxnForClassification } from "./rules";
import { detect, matchTransferPairs, splitLoanPayment } from "./detectors";

const txn = (o: Partial<TxnForClassification> & { id: string }): TxnForClassification => ({
  date: "2025-03-15",
  rawDescription: "GENERIC PAYEE",
  amountCents: 10000,
  direction: "debit",
  accountId: "acctA",
  ...o,
});

const noLlm: LlmClassifier = async () => new Map();
const ctx = { businessType: "e-commerce", entityType: "SINGLE_MEMBER_LLC" };

describe("matchRules", () => {
  it("matches CONTAINS case-insensitively with normalized whitespace", () => {
    const m = matchRules(txn({ id: "1", rawDescription: "stripe   payout 123", direction: "credit" }), GLOBAL_STARTER_RULES);
    expect(m?.categoryCode).toBe("INC_SALES");
  });
  it("respects direction constraints", () => {
    // STRIPE rule is credit-only; a debit to Stripe must not match it
    const m = matchRules(txn({ id: "1", rawDescription: "STRIPE CHARGEBACK", direction: "debit" }), GLOBAL_STARTER_RULES);
    expect(m).toBeNull();
  });
  it("lower priority number wins", () => {
    const m = matchRules(txn({ id: "1", rawDescription: "ACME LLC" }), [
      { id: "r2", matchType: "CONTAINS", pattern: "ACME", categoryCode: "EXP_OTHER", priority: 200 },
      { id: "r1", matchType: "CONTAINS", pattern: "ACME", categoryCode: "EXP_CONTRACTORS", priority: 100 },
    ]);
    expect(m?.ruleId).toBe("r1");
  });
  it("never crashes on a bad admin regex", () => {
    const m = matchRules(txn({ id: "1" }), [
      { id: "bad", matchType: "REGEX", pattern: "([", categoryCode: "EXP_OTHER", priority: 1 },
    ]);
    expect(m).toBeNull();
  });
});

describe("detectors", () => {
  it("detects owner-style deposits", () => {
    const d = detect(txn({ id: "1", rawDescription: "MOBILE DEPOSIT REF 8842", direction: "credit" }));
    expect(d.some((x) => x.flag === "OWNER_DEPOSIT")).toBe(true);
  });
  it("detects credit card payments", () => {
    const d = detect(txn({ id: "1", rawDescription: "CHASE CARD AUTOPAY PPD" }));
    expect(d.some((x) => x.flag === "CREDIT_CARD_PAYMENT")).toBe(true);
  });
  it("detects large purchases above threshold only", () => {
    expect(detect(txn({ id: "1", rawDescription: "DELL COMPUTERS", amountCents: 300000 })).some((x) => x.flag === "LARGE_PURCHASE")).toBe(true);
    expect(detect(txn({ id: "2", rawDescription: "DELL COMPUTERS", amountCents: 200000 })).some((x) => x.flag === "LARGE_PURCHASE")).toBe(false);
  });
  it("detects tax payments", () => {
    const d = detect(txn({ id: "1", rawDescription: "IRS USATAXPYMT 220415" }));
    expect(d.some((x) => x.flag === "TAX_PAYMENT")).toBe(true);
  });
});

describe("matchTransferPairs", () => {
  it("pairs equal amounts across different accounts within window", () => {
    const res = matchTransferPairs([
      txn({ id: "d1", rawDescription: "ONLINE TRANSFER TO SAVINGS", amountCents: 50000, direction: "debit", accountId: "A", date: "2025-03-10" }),
      txn({ id: "c1", rawDescription: "ONLINE TRANSFER FROM CHECKING", amountCents: 50000, direction: "credit", accountId: "B", date: "2025-03-11" }),
    ]);
    expect(res.pairs).toHaveLength(1);
    expect(res.unmatchedTxnIds).toHaveLength(0);
  });
  it("never pairs within the same account", () => {
    const res = matchTransferPairs([
      txn({ id: "d1", amountCents: 50000, direction: "debit", accountId: "A" }),
      txn({ id: "c1", amountCents: 50000, direction: "credit", accountId: "A" }),
    ]);
    expect(res.pairs).toHaveLength(0);
    expect(res.unmatchedTxnIds).toHaveLength(2);
  });
  it("leaves unmatched transfers flagged when amount differs", () => {
    const res = matchTransferPairs([
      txn({ id: "d1", amountCents: 50000, direction: "debit", accountId: "A" }),
      txn({ id: "c1", amountCents: 49999, direction: "credit", accountId: "B" }),
    ]);
    expect(res.pairs).toHaveLength(0);
    expect(res.unmatchedTxnIds).toEqual(["d1", "c1"]);
  });
  it("respects the date window", () => {
    const res = matchTransferPairs([
      txn({ id: "d1", amountCents: 50000, direction: "debit", accountId: "A", date: "2025-03-01" }),
      txn({ id: "c1", amountCents: 50000, direction: "credit", accountId: "B", date: "2025-03-20" }),
    ]);
    expect(res.pairs).toHaveLength(0);
  });
});

describe("splitLoanPayment", () => {
  it("splits principal vs interest with simple amortization", () => {
    // $10,000 balance at 12% APR → $100 interest this month on a $500 payment
    const s = splitLoanPayment(50000, 1000000, 12);
    expect(s.interestCents).toBe(10000);
    expect(s.principalCents).toBe(40000);
  });
  it("caps interest at the payment amount", () => {
    const s = splitLoanPayment(5000, 10000000, 24);
    expect(s.interestCents).toBe(5000);
    expect(s.principalCents).toBe(0);
  });
});

describe("classifyEngagement — the orchestrator", () => {
  it("acceptance criterion 3: paired transfers excluded from P&L", async () => {
    const res = await classifyEngagement(
      [
        txn({ id: "d1", rawDescription: "ONLINE TRANSFER TO ****9921", amountCents: 100000, direction: "debit", accountId: "A" }),
        txn({ id: "c1", rawDescription: "ONLINE TRANSFER FROM ****4821", amountCents: 100000, direction: "credit", accountId: "B" }),
      ],
      GLOBAL_STARTER_RULES,
      noLlm,
      ctx
    );
    const d1 = res.results.get("d1")!;
    const c1 = res.results.get("c1")!;
    expect(d1.excludeFromPnl).toBe(true);
    expect(c1.excludeFromPnl).toBe(true);
    expect(d1.categoryCode).toBe("NPL_TRANSFER");
    expect(d1.transferPairTxnId).toBe("c1");
  });

  it("acceptance criterion 4: owner deposit NEVER auto-classified as revenue", async () => {
    // even with an LLM that would happily call it revenue
    const eagerLlm: LlmClassifier = async (txns) =>
      new Map(txns.map((t) => [t.id, { categoryCode: "INC_SALES", confidence: "high" as const, rationale: "looks like income" }]));
    const res = await classifyEngagement(
      [txn({ id: "1", rawDescription: "MOBILE DEPOSIT 4432", amountCents: 500000, direction: "credit" })],
      GLOBAL_STARTER_RULES,
      eagerLlm,
      ctx
    );
    const r = res.results.get("1")!;
    expect(r.flag).toBe("OWNER_DEPOSIT");
    expect(r.categoryCode).not.toBe("INC_SALES");
    expect(r.excludeFromPnl).toBe(true);
  });

  it("rules run before LLM", async () => {
    let llmCalled = false;
    const spyLlm: LlmClassifier = async (txns) => {
      llmCalled = txns.length > 0;
      return new Map();
    };
    const res = await classifyEngagement(
      [txn({ id: "1", rawDescription: "GOOGLE ADS 88231", direction: "debit" })],
      GLOBAL_STARTER_RULES,
      spyLlm,
      ctx
    );
    expect(res.results.get("1")!.classifiedBy).toBe("RULE");
    expect(res.results.get("1")!.categoryCode).toBe("EXP_ADVERTISING");
    expect(llmCalled).toBe(false);
  });

  it("low-confidence LLM results are NOT classified — flagged instead", async () => {
    const unsureLlm: LlmClassifier = async (txns) =>
      new Map(txns.map((t) => [t.id, { categoryCode: "EXP_OTHER", confidence: "low" as const, rationale: "unclear payee" }]));
    const res = await classifyEngagement([txn({ id: "1", rawDescription: "ZKX 42 PAYMENT" })], [], unsureLlm, ctx);
    const r = res.results.get("1")!;
    expect(r.categoryCode).toBeNull();
    expect(r.confidence).toBe("LOW");
    expect(r.flag).toBe("LOW_CONFIDENCE");
  });

  it("invalid category codes from the LLM are rejected, not trusted", async () => {
    const hallucinatingLlm: LlmClassifier = async (txns) =>
      new Map(txns.map((t) => [t.id, { categoryCode: "EXP_MADE_UP", confidence: "high" as const, rationale: "..." }]));
    const res = await classifyEngagement([txn({ id: "1" })], [], hallucinatingLlm, ctx);
    expect(res.results.get("1")!.categoryCode).toBeNull();
    expect(res.results.get("1")!.flag).toBe("LOW_CONFIDENCE");
  });

  it("credit card payments excluded from P&L with flag", async () => {
    const res = await classifyEngagement(
      [txn({ id: "1", rawDescription: "AMEX EPAYMENT ACH PMT", amountCents: 80000 })],
      GLOBAL_STARTER_RULES,
      noLlm,
      ctx
    );
    const r = res.results.get("1")!;
    expect(r.flag).toBe("CREDIT_CARD_PAYMENT");
    expect(r.excludeFromPnl).toBe(true);
  });

  it("tax payments are categorized separately, never generic", async () => {
    const res = await classifyEngagement(
      [txn({ id: "1", rawDescription: "IRS USATAXPYMT 0415" })],
      GLOBAL_STARTER_RULES,
      noLlm,
      ctx
    );
    const r = res.results.get("1")!;
    expect(r.flag).toBe("TAX_PAYMENT");
    expect(["EXP_PAYROLL_TAXES", "EXP_SALES_TAX"]).toContain(r.categoryCode);
  });

  it("large purchase keeps flag even when AI classifies it", async () => {
    const confidentLlm: LlmClassifier = async (txns) =>
      new Map(txns.map((t) => [t.id, { categoryCode: "EXP_OFFICE", confidence: "high" as const, rationale: "computer equipment vendor" }]));
    const res = await classifyEngagement(
      [txn({ id: "1", rawDescription: "APPLE STORE R123", amountCents: 400000 })],
      [],
      confidentLlm,
      ctx
    );
    const r = res.results.get("1")!;
    expect(r.flag).toBe("LARGE_PURCHASE");
    expect(r.categoryCode).toBe("EXP_OFFICE");
  });

  it("stats support the 5–10% review target", async () => {
    const txns: TxnForClassification[] = [];
    for (let i = 0; i < 50; i++) {
      txns.push(txn({ id: `s${i}`, rawDescription: "STRIPE PAYOUT ST-K3", direction: "credit" }));
    }
    txns.push(txn({ id: "odd", rawDescription: "UNKNOWN WIRE 999", amountCents: 999999 }));
    const res = await classifyEngagement(txns, GLOBAL_STARTER_RULES, noLlm, ctx);
    expect(res.stats.byRule).toBeGreaterThanOrEqual(50);
    expect(res.stats.flagged).toBeLessThanOrEqual(2);
  });
});
