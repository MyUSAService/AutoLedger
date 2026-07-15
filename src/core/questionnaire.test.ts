import { describe, it, expect } from "vitest";
import { buildQuestionnaire, applyAnswer, loanAnswerEffects, type FlaggedTxnInput, type Question } from "./questionnaire";

const flagged = (o: Partial<FlaggedTxnInput> & { id: string; flag: FlaggedTxnInput["flag"] }): FlaggedTxnInput => ({
  date: "2025-03-15",
  description: "TEST TXN",
  amountCents: 100000,
  direction: "credit",
  ...o,
});

describe("buildQuestionnaire — dynamic, only what's relevant", () => {
  it("always asks opening, assets-any, loans-any, AR, AP", () => {
    const qs = buildQuestionnaire({ entityType: "SINGLE_MEMBER_LLC", sellsPhysicalProducts: false, flaggedTxns: [] });
    const keys = qs.map((q) => q.key);
    expect(keys).toContain("opening.firstYear");
    expect(keys).toContain("assets.any");
    expect(keys).toContain("loans.any");
    expect(keys).toContain("ar.amount");
    expect(keys).toContain("ap.ccBalance");
    expect(keys).not.toContain("inventory.amount"); // not a product business
  });

  it("asks inventory only for product businesses", () => {
    const qs = buildQuestionnaire({ entityType: "SINGLE_MEMBER_LLC", sellsPhysicalProducts: true, flaggedTxns: [] });
    expect(qs.some((q) => q.key === "inventory.amount")).toBe(true);
  });

  it("pre-populates fixed-asset questions from large-purchase detections", () => {
    const qs = buildQuestionnaire({
      entityType: "SINGLE_MEMBER_LLC",
      sellsPhysicalProducts: false,
      flaggedTxns: [flagged({ id: "t1", flag: "LARGE_PURCHASE", description: "DELL MARKETING", amountCents: 389900, direction: "debit" })],
    });
    const q = qs.find((x) => x.key === "assets.confirm.t1")!;
    expect(q.transactionId).toBe("t1");
    expect(q.vars?.amount).toBe("$3,899.00");
  });

  it("owner questions are one-per-transaction with entity-aware choices", () => {
    const qs = buildQuestionnaire({
      entityType: "C_CORP",
      sellsPhysicalProducts: false,
      flaggedTxns: [
        flagged({ id: "d1", flag: "OWNER_DEPOSIT" }),
        flagged({ id: "w1", flag: "OWNER_WITHDRAWAL", direction: "debit" }),
      ],
    });
    const withdrawal = qs.find((q) => q.key === "owner.withdrawal.w1")!;
    // C-Corp: no "Owner draw" wording (§5 entity-type awareness)
    expect(withdrawal.choices!.map((c) => c.value)).not.toContain("draw");
    expect(withdrawal.choices!.map((c) => c.value)).toContain("distribution");
    const llcQs = buildQuestionnaire({
      entityType: "SINGLE_MEMBER_LLC",
      sellsPhysicalProducts: false,
      flaggedTxns: [flagged({ id: "w1", flag: "OWNER_WITHDRAWAL", direction: "debit" })],
    });
    expect(llcQs.find((q) => q.key === "owner.withdrawal.w1")!.choices!.map((c) => c.value)).toContain("draw");
  });

  it("loan-flagged transactions force the loan details question", () => {
    const qs = buildQuestionnaire({
      entityType: "SINGLE_MEMBER_LLC",
      sellsPhysicalProducts: false,
      flaggedTxns: [flagged({ id: "l1", flag: "LOAN_ACTIVITY", direction: "debit" })],
    });
    expect(qs.some((q) => q.type === "loan_details")).toBe(true);
  });

  it("every choice question carries both Italian and English labels", () => {
    const qs = buildQuestionnaire({
      entityType: "MULTI_MEMBER_LLC",
      sellsPhysicalProducts: false,
      flaggedTxns: [flagged({ id: "d1", flag: "OWNER_DEPOSIT" }), flagged({ id: "c1", flag: "CREDIT_CARD_PAYMENT", direction: "debit" })],
    });
    for (const q of qs.filter((x) => x.type === "choice")) {
      for (const c of q.choices!) {
        expect(c.labelEn.length).toBeGreaterThan(0);
        expect(c.labelIt.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("applyAnswer — proposals, never final", () => {
  const ownerDepositQ: Question = {
    key: "owner.deposit.t1", section: "owner", type: "choice",
    i18nKey: "q.owner.deposit", transactionId: "t1",
  };

  it("owner deposit 'capital' → equity proposal, excluded from P&L", () => {
    const fx = applyAnswer(ownerDepositQ, { value: "capital" });
    expect(fx).toEqual([
      { kind: "transaction_proposal", transactionId: "t1", categoryCode: "EQ_OWNER_CAPITAL", excludeFromPnl: true, note: "Client answered: capital" },
    ]);
  });

  it("owner deposit 'revenue' → income proposal, included in P&L", () => {
    const fx = applyAnswer(ownerDepositQ, { value: "revenue" });
    expect(fx[0]).toMatchObject({ categoryCode: "INC_SALES", excludeFromPnl: false });
  });

  it("withdrawal 'reimbursement' → NO category (staff judgment), note attached", () => {
    const q: Question = { ...ownerDepositQ, key: "owner.withdrawal.t1" };
    const fx = applyAnswer(q, { value: "reimbursement" });
    expect(fx[0]).toMatchObject({ categoryCode: null });
  });

  it("asset confirmed → BS_FIXED_ASSETS; asset denied → note only, keeps classification", () => {
    const q: Question = { key: "assets.confirm.t9", section: "assets", type: "yesno", i18nKey: "q.assets.confirm", transactionId: "t9" };
    expect(applyAnswer(q, { value: "yes" })[0]).toMatchObject({ categoryCode: "BS_FIXED_ASSETS", excludeFromPnl: true });
    expect(applyAnswer(q, { value: "no" })[0]).toMatchObject({ categoryCode: null, note: expect.stringContaining("NOT a fixed asset") });
  });

  it("personal credit card → owner draw proposal", () => {
    const q: Question = { key: "flags.cc.t3", section: "flags", type: "choice", i18nKey: "x", transactionId: "t3" };
    expect(applyAnswer(q, { value: "not_business" })[0]).toMatchObject({ categoryCode: "EQ_OWNER_DRAWS", excludeFromPnl: true });
    expect(applyAnswer(q, { value: "business_card" })[0].kind).toBe("info");
  });

  it("low-confidence free text NEVER auto-classifies", () => {
    const q: Question = { key: "flags.low.t4", section: "flags", type: "text", i18nKey: "x", transactionId: "t4" };
    const fx = applyAnswer(q, { text: "pagamento fornitore packaging" });
    expect(fx[0]).toMatchObject({ kind: "transaction_proposal", categoryCode: null });
    expect((fx[0] as { note: string }).note).toContain("packaging");
  });

  it("AR / CC-balance / inventory amounts become sourced balance-sheet lines", () => {
    const ar: Question = { key: "ar.amount", section: "ar", type: "amount", i18nKey: "x" };
    expect(applyAnswer(ar, { amountCents: 500000 })[0]).toMatchObject({ kind: "balance_sheet_line", categoryCode: "BS_AR", amountCents: 500000 });
    const cc: Question = { key: "ap.ccBalance", section: "ap", type: "amount", i18nKey: "x" };
    expect(applyAnswer(cc, { amountCents: 120000 })[0]).toMatchObject({ categoryCode: "BS_CC_PAYABLE" });
    const zero = applyAnswer(ar, { amountCents: 0 });
    expect(zero).toHaveLength(0); // zero balances create no line
  });

  it("supplier AP total is info-only on cash basis (staff assesses)", () => {
    const ap: Question = { key: "ap.amount", section: "ap", type: "amount", i18nKey: "x" };
    const fx = applyAnswer(ap, { amountCents: 340000 });
    expect(fx[0].kind).toBe("info");
  });
});

describe("loanAnswerEffects", () => {
  it("creates the liability line and a principal/interest split candidate", () => {
    const fx = loanAnswerEffects({
      lender: "SBA",
      currentBalanceCents: 2445000,
      monthlyPaymentCents: 55000,
      annualRatePct: 6,
    });
    expect(fx[0]).toMatchObject({ kind: "balance_sheet_line", categoryCode: "BS_LOANS_PAYABLE", amountCents: 2445000 });
    // interest = 2,445,000 × 6% / 12 = 12,225 cents
    expect((fx[1] as { note: string }).note).toContain("$122.25 interest");
    expect((fx[1] as { note: string }).note).toContain("$427.75 principal");
  });

  it("omits the split when rate or payment is unknown", () => {
    const fx = loanAnswerEffects({ lender: "Kabbage", currentBalanceCents: 500000 });
    expect(fx).toHaveLength(1);
  });
});
