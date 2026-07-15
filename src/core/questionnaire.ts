/**
 * Guided balance-sheet questionnaire engine (Step E, §3E).
 * Pure functions: detected flags + entity type → dynamic question list;
 * client answers → PROPOSED effects. Nothing a client answers is final —
 * staff reviews every proposal (flagResolved stays false until staff confirms).
 */

import { ownerDepositChoices, ownerWithdrawalChoices, type EntityType } from "./chartOfAccounts";
import { formatUsd } from "./money";

export interface FlaggedTxnInput {
  id: string;
  date: string; // ISO
  description: string;
  amountCents: number;
  direction: "debit" | "credit";
  flag:
    | "OWNER_DEPOSIT"
    | "OWNER_WITHDRAWAL"
    | "LARGE_PURCHASE"
    | "CREDIT_CARD_PAYMENT"
    | "LOW_CONFIDENCE"
    | "UNMATCHED_TRANSFER"
    | "LOAN_ACTIVITY";
}

export type QuestionType = "yesno" | "choice" | "amount" | "text" | "loan_details";

export interface Question {
  /** Stable key — QuestionnaireResponse.questionKey. */
  key: string;
  section: "opening" | "assets" | "loans" | "ar" | "ap" | "inventory" | "owner" | "flags";
  type: QuestionType;
  /** i18n key for the question text. */
  i18nKey: string;
  /** Interpolation vars (amounts pre-formatted). */
  vars?: Record<string, string>;
  /** For choice questions: value + bilingual labels. */
  choices?: { value: string; labelEn: string; labelIt: string }[];
  /** Linked transaction, when the question is about a specific movement. */
  transactionId?: string;
}

export interface BuildQuestionnaireInput {
  entityType: EntityType;
  sellsPhysicalProducts: boolean;
  flaggedTxns: FlaggedTxnInput[];
}

export function buildQuestionnaire(input: BuildQuestionnaireInput): Question[] {
  const qs: Question[] = [];

  // 1. Opening balances — always asked
  qs.push({ key: "opening.firstYear", section: "opening", type: "yesno", i18nKey: "q.opening.firstYear" });
  qs.push({ key: "opening.hasPrior", section: "opening", type: "yesno", i18nKey: "q.opening.hasPrior" });

  // 2. Fixed assets — pre-populated with detected large purchases
  for (const t of input.flaggedTxns.filter((t) => t.flag === "LARGE_PURCHASE")) {
    qs.push({
      key: `assets.confirm.${t.id}`,
      section: "assets",
      type: "yesno",
      i18nKey: "q.assets.confirm",
      vars: { amount: formatUsd(t.amountCents), date: t.date, payee: t.description.slice(0, 40) },
      transactionId: t.id,
    });
  }
  qs.push({ key: "assets.any", section: "assets", type: "yesno", i18nKey: "q.assets.any" });

  // 3. Loans — always asked; loan-flagged txns force the section relevant
  const hasLoanActivity = input.flaggedTxns.some((t) => t.flag === "LOAN_ACTIVITY");
  qs.push({ key: "loans.any", section: "loans", type: "yesno", i18nKey: "q.loans.any" });
  if (hasLoanActivity) {
    // pipeline saw loan payments — details are required, not optional
    qs.push({ key: "loans.details", section: "loans", type: "loan_details", i18nKey: "q.section.loans.help" });
  }

  // 4–5. AR / AP — always asked, simple totals
  qs.push({ key: "ar.amount", section: "ar", type: "amount", i18nKey: "q.ar.amount" });
  qs.push({ key: "ap.amount", section: "ap", type: "amount", i18nKey: "q.ap.amount" });
  qs.push({ key: "ap.ccBalance", section: "ap", type: "amount", i18nKey: "q.ap.ccBalance" });

  // 6. Inventory — only if relevant to the business type
  if (input.sellsPhysicalProducts) {
    qs.push({ key: "inventory.amount", section: "inventory", type: "amount", i18nKey: "q.inventory.amount" });
  }

  // 7. Owner transactions — one by one, entity-aware wording
  for (const t of input.flaggedTxns.filter((t) => t.flag === "OWNER_DEPOSIT")) {
    qs.push({
      key: `owner.deposit.${t.id}`,
      section: "owner",
      type: "choice",
      i18nKey: "q.owner.deposit",
      vars: { date: t.date, amount: formatUsd(t.amountCents), desc: t.description.slice(0, 40) },
      choices: ownerDepositChoices(input.entityType),
      transactionId: t.id,
    });
  }
  for (const t of input.flaggedTxns.filter((t) => t.flag === "OWNER_WITHDRAWAL")) {
    qs.push({
      key: `owner.withdrawal.${t.id}`,
      section: "owner",
      type: "choice",
      i18nKey: "q.owner.withdrawal",
      vars: { date: t.date, amount: formatUsd(t.amountCents), desc: t.description.slice(0, 40) },
      choices: ownerWithdrawalChoices(input.entityType),
      transactionId: t.id,
    });
  }

  // Plain-language flag resolution
  for (const t of input.flaggedTxns.filter((t) => t.flag === "CREDIT_CARD_PAYMENT")) {
    qs.push({
      key: `flags.cc.${t.id}`,
      section: "flags",
      type: "choice",
      i18nKey: "q.flag.CREDIT_CARD_PAYMENT",
      vars: { desc: t.description.slice(0, 40), amount: formatUsd(t.amountCents) },
      choices: [
        { value: "business_card", labelEn: "Yes, I'll upload the card statements", labelIt: "Sì, carico gli estratti della carta" },
        { value: "not_business", labelEn: "No, it's not a business card", labelIt: "No, non è una carta aziendale" },
      ],
      transactionId: t.id,
    });
  }
  for (const t of input.flaggedTxns.filter((t) => t.flag === "LOW_CONFIDENCE")) {
    qs.push({
      key: `flags.low.${t.id}`,
      section: "flags",
      type: "text",
      i18nKey: "q.flag.LOW_CONFIDENCE",
      vars: { desc: t.description.slice(0, 40), date: t.date, amount: formatUsd(t.amountCents) },
      transactionId: t.id,
    });
  }
  for (const t of input.flaggedTxns.filter((t) => t.flag === "UNMATCHED_TRANSFER")) {
    qs.push({
      key: `flags.transfer.${t.id}`,
      section: "flags",
      type: "yesno",
      i18nKey: "q.flag.UNMATCHED_TRANSFER",
      vars: { desc: t.description.slice(0, 40), amount: formatUsd(t.amountCents) },
      transactionId: t.id,
    });
  }

  return qs;
}

// ---------- Answer effects ----------

export type AnswerEffect =
  | {
      kind: "transaction_proposal";
      transactionId: string;
      categoryCode: string | null; // null = still needs staff, but with the client's note attached
      excludeFromPnl: boolean;
      note: string;
    }
  | {
      kind: "balance_sheet_line";
      categoryCode: string;
      label: string;
      amountCents: number;
    }
  | { kind: "info"; note: string };

const DEPOSIT_EFFECTS: Record<string, { categoryCode: string | null; excludeFromPnl: boolean }> = {
  capital: { categoryCode: "EQ_OWNER_CAPITAL", excludeFromPnl: true },
  owner_loan: { categoryCode: "BS_LOAN_FROM_OWNER", excludeFromPnl: true },
  revenue: { categoryCode: "INC_SALES", excludeFromPnl: false },
};

const WITHDRAWAL_EFFECTS: Record<string, { categoryCode: string | null; excludeFromPnl: boolean }> = {
  draw: { categoryCode: "EQ_OWNER_DRAWS", excludeFromPnl: true },
  distribution: { categoryCode: "EQ_OWNER_DRAWS", excludeFromPnl: true },
  salary: { categoryCode: "EXP_PAYROLL_WAGES", excludeFromPnl: false },
  // reimbursement & shareholder_loan need staff judgment — never guessed
  reimbursement: { categoryCode: null, excludeFromPnl: false },
  shareholder_loan: { categoryCode: null, excludeFromPnl: true },
};

/**
 * Convert a client answer into proposed effects.
 * IMPORTANT: proposals set confidence=MEDIUM and NEVER resolve the staff flag.
 */
export function applyAnswer(question: Question, answer: unknown): AnswerEffect[] {
  const a = answer as { value?: string; amountCents?: number; text?: string; loan?: LoanAnswer };

  switch (question.section) {
    case "owner": {
      if (!question.transactionId || !a.value) return [];
      const map = question.key.includes(".deposit.") ? DEPOSIT_EFFECTS : WITHDRAWAL_EFFECTS;
      const effect = map[a.value];
      if (!effect) return [];
      return [
        {
          kind: "transaction_proposal",
          transactionId: question.transactionId,
          categoryCode: effect.categoryCode,
          excludeFromPnl: effect.excludeFromPnl,
          note: `Client answered: ${a.value}`,
        },
      ];
    }

    case "assets": {
      if (!question.transactionId) {
        return a.value === "yes"
          ? [{ kind: "info", note: "Client reports additional fixed assets not detected in statements" }]
          : [];
      }
      if (a.value === "yes") {
        return [
          {
            kind: "transaction_proposal",
            transactionId: question.transactionId,
            categoryCode: "BS_FIXED_ASSETS",
            excludeFromPnl: true,
            note: "Client confirmed: fixed asset purchase",
          },
        ];
      }
      return [
        {
          kind: "transaction_proposal",
          transactionId: question.transactionId,
          categoryCode: null, // keep existing classification; staff sees the client's "no"
          excludeFromPnl: false,
          note: "Client says NOT a fixed asset — keep as regular expense",
        },
      ];
    }

    case "flags": {
      if (question.key.startsWith("flags.cc.") && question.transactionId) {
        if (a.value === "not_business") {
          // paying a personal card from the business account = owner money out
          return [
            {
              kind: "transaction_proposal",
              transactionId: question.transactionId,
              categoryCode: "EQ_OWNER_DRAWS",
              excludeFromPnl: true,
              note: "Client says personal credit card — treated as owner draw (staff to confirm)",
            },
          ];
        }
        return [{ kind: "info", note: "Client will upload business credit card statements" }];
      }
      if (question.key.startsWith("flags.low.") && question.transactionId) {
        return [
          {
            kind: "transaction_proposal",
            transactionId: question.transactionId,
            categoryCode: null, // free text is context for staff, never auto-classified
            excludeFromPnl: false,
            note: `Client explains: ${(a.text ?? "").slice(0, 200)}`,
          },
        ];
      }
      if (question.key.startsWith("flags.transfer.")) {
        return [
          {
            kind: "info",
            note: a.value === "yes" ? "Client has another account to upload (unmatched transfer)" : "Client says no other account — staff to investigate transfer",
          },
        ];
      }
      return [];
    }

    case "loans": {
      if (question.type === "loan_details" && a.loan) {
        return loanAnswerEffects(a.loan);
      }
      return a.value === "yes" ? [{ kind: "info", note: "Client reports active loans" }] : [];
    }

    case "ar":
      return amountLine(a, "BS_AR", "Accounts Receivable (client questionnaire)");
    case "ap":
      if (question.key === "ap.ccBalance") return amountLine(a, "BS_CC_PAYABLE", "Credit Cards Payable (client questionnaire)");
      return a.amountCents != null && a.amountCents > 0
        ? [{ kind: "info", note: `Client reports unpaid supplier bills at year end: ${formatUsd(a.amountCents)} (cash basis — staff to assess)` }]
        : [];
    case "inventory":
      return amountLine(a, "BS_INVENTORY", "Inventory (client questionnaire)");
    case "opening":
      return a.value === "yes" && question.key === "opening.hasPrior"
        ? [{ kind: "info", note: "Client has prior-year balance sheet to provide" }]
        : [];
  }
  return [];
}

function amountLine(a: { amountCents?: number }, categoryCode: string, label: string): AnswerEffect[] {
  if (a.amountCents == null || a.amountCents < 0) return [];
  if (a.amountCents === 0) return [];
  return [{ kind: "balance_sheet_line", categoryCode, label, amountCents: a.amountCents }];
}

// ---------- Loan details ----------

export interface LoanAnswer {
  lender: string;
  originalAmountCents?: number;
  currentBalanceCents: number;
  monthlyPaymentCents?: number;
  annualRatePct?: number;
}

export function loanAnswerEffects(loan: LoanAnswer): AnswerEffect[] {
  const effects: AnswerEffect[] = [
    {
      kind: "balance_sheet_line",
      categoryCode: "BS_LOANS_PAYABLE",
      label: `Loan — ${loan.lender} (client questionnaire)`,
      amountCents: loan.currentBalanceCents,
    },
  ];
  if (loan.monthlyPaymentCents && loan.annualRatePct != null) {
    const interest = Math.min(
      loan.monthlyPaymentCents,
      Math.round((loan.currentBalanceCents * loan.annualRatePct) / 100 / 12)
    );
    effects.push({
      kind: "info",
      note: `Loan split candidate for ${loan.lender}: monthly payment ${formatUsd(loan.monthlyPaymentCents)} ≈ ${formatUsd(loan.monthlyPaymentCents - interest)} principal + ${formatUsd(interest)} interest (staff to apply)`,
    });
  }
  return effects;
}
