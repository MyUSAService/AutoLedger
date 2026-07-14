/**
 * Chart of Accounts v1 (cash basis) — §5 of the spec.
 * Ships as the built-in default; admin-editable per client in Phase 3.
 */

export type AccountSection =
  | "income"
  | "expense"
  | "asset"
  | "liability"
  | "equity"
  | "non_pnl"; // transfers, loan principal, owner txns — NEVER on the income statement

export interface CoaCategory {
  code: string;
  name: string;
  section: AccountSection;
  /** Extra handling notes surfaced to the classifier and the preparer. */
  note?: string;
}

export const CHART_OF_ACCOUNTS: CoaCategory[] = [
  // ---- Income ----
  { code: "INC_SALES", name: "Sales/Service Revenue", section: "income" },
  { code: "INC_REFUNDS", name: "Refunds Issued (contra)", section: "income" },
  { code: "INC_INTEREST", name: "Interest Income", section: "income" },
  { code: "INC_OTHER", name: "Other Income", section: "income" },

  // ---- Expenses ----
  { code: "EXP_ADVERTISING", name: "Advertising & Marketing", section: "expense" },
  { code: "EXP_BANK_FEES", name: "Bank & Merchant Fees", section: "expense" },
  { code: "EXP_CONTRACTORS", name: "Contractors/Professional Services", section: "expense", note: "Potential 1099 vendors — mark any vendor paid >$600/yr" },
  { code: "EXP_INSURANCE", name: "Insurance", section: "expense" },
  { code: "EXP_LEGAL_ACCT", name: "Legal & Accounting", section: "expense" },
  { code: "EXP_MEALS", name: "Meals (50%)", section: "expense" },
  { code: "EXP_OFFICE", name: "Office Supplies & Software", section: "expense" },
  { code: "EXP_PAYROLL_WAGES", name: "Payroll Wages", section: "expense" },
  { code: "EXP_PAYROLL_TAXES", name: "Payroll Taxes", section: "expense" },
  { code: "EXP_RENT", name: "Rent", section: "expense" },
  { code: "EXP_REPAIRS", name: "Repairs & Maintenance", section: "expense" },
  { code: "EXP_PHONE_INTERNET", name: "Telephone & Internet", section: "expense" },
  { code: "EXP_TRAVEL", name: "Travel", section: "expense" },
  { code: "EXP_UTILITIES", name: "Utilities", section: "expense" },
  { code: "EXP_VEHICLE", name: "Vehicle", section: "expense" },
  { code: "EXP_SALES_TAX", name: "Sales Tax Remitted", section: "expense" },
  { code: "EXP_OTHER", name: "Other Expenses", section: "expense", note: "Must stay <5% of total expenses — if larger, force review" },

  // ---- Balance sheet ----
  { code: "BS_CASH", name: "Cash (per account)", section: "asset" },
  { code: "BS_AR", name: "Accounts Receivable", section: "asset" },
  { code: "BS_INVENTORY", name: "Inventory", section: "asset" },
  { code: "BS_FIXED_ASSETS", name: "Fixed Assets", section: "asset" },
  { code: "BS_ACCUM_DEPR", name: "Accumulated Depreciation", section: "asset", note: "Staff-entered" },
  { code: "BS_LOANS_PAYABLE", name: "Loans Payable", section: "liability" },
  { code: "BS_CC_PAYABLE", name: "Credit Cards Payable", section: "liability" },
  { code: "BS_LOAN_FROM_OWNER", name: "Loans from Owner", section: "liability" },
  { code: "EQ_OWNER_CAPITAL", name: "Owner Capital/Contributions", section: "equity" },
  { code: "EQ_OWNER_DRAWS", name: "Owner Draws/Distributions", section: "equity" },
  { code: "EQ_RETAINED", name: "Retained Earnings (computed)", section: "equity" },

  // ---- Non-P&L movements ----
  { code: "NPL_TRANSFER", name: "Inter-account Transfers", section: "non_pnl" },
  { code: "NPL_LOAN_PRINCIPAL", name: "Loan Principal", section: "non_pnl" },
  { code: "NPL_OWNER_DEPOSIT", name: "Owner Deposit (pending client answer)", section: "non_pnl" },
  { code: "NPL_OWNER_WITHDRAWAL", name: "Owner Withdrawal (pending client answer)", section: "non_pnl" },
  { code: "NPL_CC_PAYMENT", name: "Credit Card Payment (pending CC statements)", section: "non_pnl" },
];

export const COA_BY_CODE = new Map(CHART_OF_ACCOUNTS.map((c) => [c.code, c]));

export function isValidCategoryCode(code: string): boolean {
  return COA_BY_CODE.has(code);
}

/** Categories allowed on the income statement. */
export function isPnlCategory(code: string): boolean {
  const c = COA_BY_CODE.get(code);
  return c?.section === "income" || c?.section === "expense";
}

/**
 * Entity-type-aware wording (§5): C-Corps have no "Owner Draw".
 */
export type EntityType = "SINGLE_MEMBER_LLC" | "MULTI_MEMBER_LLC" | "C_CORP";

export function ownerWithdrawalChoices(entityType: EntityType): { value: string; labelEn: string; labelIt: string }[] {
  if (entityType === "C_CORP") {
    return [
      { value: "salary", labelEn: "Salary (payroll)", labelIt: "Stipendio (busta paga)" },
      { value: "distribution", labelEn: "Shareholder distribution/dividend", labelIt: "Distribuzione/dividendo ai soci" },
      { value: "shareholder_loan", labelEn: "Loan to shareholder", labelIt: "Prestito al socio" },
      { value: "reimbursement", labelEn: "Expense reimbursement", labelIt: "Rimborso spese" },
    ];
  }
  return [
    { value: "draw", labelEn: "Owner draw", labelIt: "Prelievo del titolare" },
    { value: "distribution", labelEn: "Distribution", labelIt: "Distribuzione" },
    { value: "salary", labelEn: "Salary (payroll)", labelIt: "Stipendio (busta paga)" },
    { value: "reimbursement", labelEn: "Expense reimbursement", labelIt: "Rimborso spese" },
  ];
}

export function ownerDepositChoices(entityType: EntityType): { value: string; labelEn: string; labelIt: string }[] {
  const capital =
    entityType === "C_CORP"
      ? { value: "capital", labelEn: "Capital contribution (equity)", labelIt: "Conferimento di capitale" }
      : { value: "capital", labelEn: "Capital contribution", labelIt: "Apporto di capitale del titolare" };
  return [
    capital,
    { value: "owner_loan", labelEn: "Loan from owner", labelIt: "Prestito del titolare alla società" },
    { value: "revenue", labelEn: "Business revenue", labelIt: "Ricavo dell'attività" },
  ];
}
