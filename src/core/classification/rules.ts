/**
 * Deterministic rules layer (§3D layer 1) — runs BEFORE any LLM call.
 * Rules are admin-editable and learnable from staff reclassifications.
 */

export interface RuleDef {
  id: string;
  matchType: "EXACT" | "CONTAINS" | "REGEX";
  pattern: string;
  direction?: "debit" | "credit" | null;
  categoryCode: string;
  priority: number; // lower runs first
}

export interface TxnForClassification {
  id: string;
  date: string;
  rawDescription: string;
  amountCents: number;
  direction: "debit" | "credit";
  accountId: string;
}

export interface RuleMatch {
  ruleId: string;
  categoryCode: string;
  rationale: string;
}

const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

export function matchRules(txn: TxnForClassification, rules: RuleDef[]): RuleMatch | null {
  const desc = normalize(txn.rawDescription);
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (rule.direction && rule.direction !== txn.direction) continue;
    let hit = false;
    switch (rule.matchType) {
      case "EXACT":
        hit = desc === normalize(rule.pattern);
        break;
      case "CONTAINS":
        hit = desc.includes(normalize(rule.pattern));
        break;
      case "REGEX":
        try {
          hit = new RegExp(rule.pattern, "i").test(txn.rawDescription);
        } catch {
          hit = false; // bad regex in an admin rule must never crash the pipeline
        }
        break;
    }
    if (hit) {
      return {
        ruleId: rule.id,
        categoryCode: rule.categoryCode,
        rationale: `Matched ${rule.matchType.toLowerCase()} rule "${rule.pattern}"`,
      };
    }
  }
  return null;
}

/**
 * Global starter rules for common US small-business payees.
 * Client-specific learned rules always take priority (lower number).
 */
export const GLOBAL_STARTER_RULES: RuleDef[] = [
  { id: "g-stripe", matchType: "CONTAINS", pattern: "STRIPE", direction: "credit", categoryCode: "INC_SALES", priority: 500 },
  { id: "g-shopify", matchType: "CONTAINS", pattern: "SHOPIFY", direction: "credit", categoryCode: "INC_SALES", priority: 500 },
  { id: "g-paypal-credit", matchType: "REGEX", pattern: "PAYPAL.*TRANSFER", direction: "credit", categoryCode: "INC_SALES", priority: 510 },
  { id: "g-amazon-mkt", matchType: "CONTAINS", pattern: "AMAZON MKTPL", direction: "debit", categoryCode: "EXP_OFFICE", priority: 520 },
  { id: "g-google-ads", matchType: "REGEX", pattern: "GOOGLE\\s*(ADS|ADWORDS)", direction: "debit", categoryCode: "EXP_ADVERTISING", priority: 500 },
  { id: "g-meta-ads", matchType: "REGEX", pattern: "(FACEBK|META\\s*PLATFORMS?)", direction: "debit", categoryCode: "EXP_ADVERTISING", priority: 500 },
  { id: "g-service-fee", matchType: "REGEX", pattern: "(MONTHLY\\s+)?SERVICE\\s+FEE", direction: "debit", categoryCode: "EXP_BANK_FEES", priority: 500 },
  { id: "g-wire-fee", matchType: "REGEX", pattern: "WIRE\\s+(TRANSFER\\s+)?FEE", direction: "debit", categoryCode: "EXP_BANK_FEES", priority: 500 },
  { id: "g-gusto", matchType: "CONTAINS", pattern: "GUSTO", direction: "debit", categoryCode: "EXP_PAYROLL_WAGES", priority: 500 },
  { id: "g-adp", matchType: "REGEX", pattern: "\\bADP\\b", direction: "debit", categoryCode: "EXP_PAYROLL_WAGES", priority: 500 },
  { id: "g-irs-941", matchType: "REGEX", pattern: "IRS\\s*USATAXPYMT|EFTPS", direction: "debit", categoryCode: "EXP_PAYROLL_TAXES", priority: 400 },
  { id: "g-fl-dor", matchType: "REGEX", pattern: "FL\\s*DEPT\\s*REVENUE|FLA\\s*DEPT\\s*OF\\s*REV", direction: "debit", categoryCode: "EXP_SALES_TAX", priority: 400 },
  { id: "g-comcast", matchType: "REGEX", pattern: "(COMCAST|XFINITY|AT&T|VERIZON|T-MOBILE)", direction: "debit", categoryCode: "EXP_PHONE_INTERNET", priority: 520 },
  { id: "g-fpl", matchType: "REGEX", pattern: "(FPL|FLORIDA POWER|DUKE ENERGY)", direction: "debit", categoryCode: "EXP_UTILITIES", priority: 520 },
];
