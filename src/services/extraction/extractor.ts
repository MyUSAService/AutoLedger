/**
 * Extraction service (§3B) — Claude PDF vision → strict JSON → reconciliation gate.
 *
 * Flow per statement:
 *   1. Chunk PDF by page range if long; one extraction call per chunk; merge.
 *   2. Validate against the zod schema + the four statement anchors.
 *   3. Reconciliation gate. If it fails: ONE corrective retry with the
 *      discrepancy shown. If it still fails: FAILED_RECONCILIATION → staff queue.
 *
 * The Anthropic client is injected so tests can stub it (no SDK import here
 * beyond types). Every call is logged (model, prompt version, raw response).
 */

import fs from "fs";
import path from "path";
import { ExtractionResultSchema, mergeChunks, type ExtractionResult } from "./schema";
import { reconcile, findRunningBalanceBreaks, type ReconciliationProof, type StatementForRecon } from "@/core/reconciliation";
import { parseCents, formatCents } from "@/core/money";

export const EXTRACTION_PROMPT_VERSION = "v1";

export interface ModelCallLog {
  purpose: "extraction" | "extraction_retry";
  model: string;
  promptVersion: string;
  pageRange: string | null;
  rawResponse: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Minimal surface of the Anthropic client we depend on — stubbed in tests. */
export interface PdfExtractionClient {
  extract(args: {
    pdfBase64: string;
    prompt: string;
    pageRange?: { first: number; last: number };
  }): Promise<{ text: string; inputTokens?: number; outputTokens?: number; model: string }>;
}

export type ExtractionOutcome =
  | {
      status: "ok";
      result: ExtractionResult;
      proof: ReconciliationProof;
      attempts: number;
      logs: ModelCallLog[];
    }
  | {
      status: "failed_reconciliation";
      result: ExtractionResult;
      proof: ReconciliationProof;
      attempts: number;
      logs: ModelCallLog[];
    }
  | { status: "invalid_json"; error: string; logs: ModelCallLog[] };

function loadPrompt(name: string): string {
  const p = path.join(process.cwd(), "prompts", name);
  const raw = fs.readFileSync(p, "utf8");
  // strip the metadata header above the `---` separator
  const idx = raw.indexOf("\n---\n");
  return idx >= 0 ? raw.slice(idx + 5).trim() : raw.trim();
}

export function parseModelJson(text: string): unknown {
  // Models sometimes wrap JSON in fences despite instructions — strip defensively.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export function toReconInput(r: ExtractionResult): StatementForRecon {
  if (r.opening_balance === null || r.closing_balance === null) {
    throw new Error("cannot reconcile without opening and closing balances");
  }
  return {
    openingBalanceCents: parseCents(r.opening_balance),
    closingBalanceCents: parseCents(r.closing_balance),
    lines: r.lines.map((l) => ({
      date: l.date,
      description: l.description,
      amountCents: Math.abs(parseCents(l.amount)),
      direction: l.direction,
      runningBalanceCents: l.running_balance !== null ? parseCents(l.running_balance) : null,
    })),
  };
}

export async function extractStatement(
  client: PdfExtractionClient,
  pdfBase64: string,
  opts: { pageCount: number; maxPagesPerChunk?: number } = { pageCount: 1 }
): Promise<ExtractionOutcome> {
  const logs: ModelCallLog[] = [];
  const basePrompt = loadPrompt(`extraction.${EXTRACTION_PROMPT_VERSION}.md`);
  const maxPages = opts.maxPagesPerChunk ?? Number(process.env.EXTRACTION_MAX_PAGES_PER_CHUNK ?? 8);

  const runPass = async (prompt: string, purpose: "extraction" | "extraction_retry"): Promise<ExtractionResult> => {
    const chunks: ExtractionResult[] = [];
    const ranges: { first: number; last: number }[] = [];
    for (let first = 1; first <= opts.pageCount; first += maxPages) {
      ranges.push({ first, last: Math.min(first + maxPages - 1, opts.pageCount) });
    }
    for (const range of ranges) {
      const res = await client.extract({
        pdfBase64,
        prompt,
        pageRange: ranges.length > 1 ? range : undefined,
      });
      logs.push({
        purpose,
        model: res.model,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        pageRange: ranges.length > 1 ? `${range.first}-${range.last}` : null,
        rawResponse: res.text,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      });
      const parsed = ExtractionResultSchema.parse(parseModelJson(res.text));
      chunks.push(parsed);
    }
    return mergeChunks(chunks);
  };

  // ---- Pass 1 ----
  let result: ExtractionResult;
  try {
    result = await runPass(basePrompt, "extraction");
  } catch (e) {
    return { status: "invalid_json", error: String(e), logs };
  }

  if (!result.is_bank_statement || result.opening_balance === null || result.closing_balance === null) {
    // Anchor validation handled upstream (validateStatementAnchors); no recon possible.
    const proof: ReconciliationProof = {
      openingBalanceCents: 0, sumCreditsCents: 0, sumDebitsCents: 0,
      computedClosingCents: 0, statedClosingCents: 0, discrepancyCents: 0,
      ties: false, formula: "not reconcilable — missing anchors",
    };
    return { status: "failed_reconciliation", result, proof, attempts: 1, logs };
  }

  let recon = toReconInput(result);
  let proof = reconcile(recon);
  if (proof.ties) return { status: "ok", result, proof, attempts: 1, logs };

  // ---- Corrective retry (exactly one, §3C) ----
  const breaks = findRunningBalanceBreaks(recon);
  const breakHints =
    breaks.length > 0
      ? `Running-balance analysis localized ${breaks.length} suspect line(s):\n` +
        breaks
          .slice(0, 5)
          .map(
            (b) =>
              `- Line ${b.index + 1} ("${b.line.description}", ${b.line.date}): computed balance ${formatCents(b.expectedCents)} but statement shows ${formatCents(b.statedCents)}`
          )
          .join("\n")
      : "Running balances were not available to localize the error.";

  const retryPrompt =
    basePrompt +
    "\n\n" +
    loadPrompt(`extraction-retry.${EXTRACTION_PROMPT_VERSION}.md`)
      .replace("{{DISCREPANCY}}", formatCents(proof.discrepancyCents))
      .replace("{{BREAK_HINTS}}", breakHints);

  let retryResult: ExtractionResult;
  try {
    retryResult = await runPass(retryPrompt, "extraction_retry");
  } catch (e) {
    // Retry produced garbage — keep pass-1 result, mark failed. Never guess.
    return { status: "failed_reconciliation", result, proof, attempts: 2, logs };
  }

  if (retryResult.opening_balance !== null && retryResult.closing_balance !== null) {
    const retryRecon = toReconInput(retryResult);
    const retryProof = reconcile(retryRecon);
    if (retryProof.ties) {
      return { status: "ok", result: retryResult, proof: retryProof, attempts: 2, logs };
    }
    return { status: "failed_reconciliation", result: retryResult, proof: retryProof, attempts: 2, logs };
  }
  return { status: "failed_reconciliation", result, proof, attempts: 2, logs };
}
