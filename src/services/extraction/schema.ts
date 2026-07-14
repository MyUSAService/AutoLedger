/**
 * Strict zod schema for the extraction JSON (§3B).
 * Anything that doesn't validate is a REJECTED extraction — loud, not silent.
 */
import { z } from "zod";
import { parseCents } from "@/core/money";

const decimalString = z
  .string()
  .refine((s) => {
    try {
      parseCents(s);
      return true;
    } catch {
      return false;
    }
  }, "not a parseable decimal amount");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const ExtractedLineSchema = z.object({
  date: isoDate,
  description: z.string().min(1),
  amount: decimalString,
  direction: z.enum(["debit", "credit"]),
  running_balance: decimalString.nullable(),
});

export const ExtractionResultSchema = z.object({
  is_bank_statement: z.boolean(),
  bank_name: z.string().nullable(),
  account_last4: z
    .string()
    .regex(/^\d{4}$/, "exactly 4 digits — never a full account number")
    .nullable(),
  account_type: z.enum(["checking", "savings", "credit_card", "other"]).nullable(),
  currency: z.string().nullable(),
  period_start: isoDate.nullable(),
  period_end: isoDate.nullable(),
  opening_balance: decimalString.nullable(),
  closing_balance: decimalString.nullable(),
  lines: z.array(ExtractedLineSchema),
  continues_beyond_these_pages: z.boolean(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/**
 * Step-A validation (§3A): is this a usable bank statement?
 * All four anchors must be present or the document is rejected with a
 * plain-language reason the client can act on.
 */
export type ValidationOutcome =
  | { ok: true }
  | { ok: false; reasonEn: string; reasonIt: string };

export function validateStatementAnchors(r: ExtractionResult): ValidationOutcome {
  if (!r.is_bank_statement) {
    return {
      ok: false,
      reasonEn: "This file does not appear to be a bank statement. Please upload the official PDF statement from your bank.",
      reasonIt: "Questo file non sembra essere un estratto conto bancario. Carica l'estratto conto PDF ufficiale della tua banca.",
    };
  }
  const missingEn: string[] = [];
  const missingIt: string[] = [];
  if (!r.account_last4) { missingEn.push("account number"); missingIt.push("numero di conto"); }
  if (!r.period_start || !r.period_end) { missingEn.push("statement period"); missingIt.push("periodo dell'estratto conto"); }
  if (r.opening_balance === null) { missingEn.push("opening balance"); missingIt.push("saldo iniziale"); }
  if (r.closing_balance === null) { missingEn.push("closing balance"); missingIt.push("saldo finale"); }
  if (missingEn.length > 0) {
    return {
      ok: false,
      reasonEn: `The statement is missing: ${missingEn.join(", ")}. Please upload the complete statement (all pages).`,
      reasonIt: `Nell'estratto conto mancano: ${missingIt.join(", ")}. Carica l'estratto conto completo (tutte le pagine).`,
    };
  }
  return { ok: true };
}

/** Merge chunked extractions (long statements processed by page range). */
export function mergeChunks(chunks: ExtractionResult[]): ExtractionResult {
  if (chunks.length === 0) throw new Error("no chunks to merge");
  const first = chunks[0];
  const last = chunks[chunks.length - 1];
  return {
    ...first,
    // document-level fields: first chunk wins except closing data from last
    closing_balance: last.closing_balance ?? first.closing_balance,
    period_end: last.period_end ?? first.period_end,
    lines: chunks.flatMap((c) => c.lines),
    continues_beyond_these_pages: last.continues_beyond_these_pages,
  };
}
