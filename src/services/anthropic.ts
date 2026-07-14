/**
 * Real Anthropic API adapters. The ONLY file that talks to the SDK.
 * API key comes from ANTHROPIC_API_KEY env var — never hardcoded, never logged.
 *
 * Data-flow note (§ Security): client financial documents are sent to the
 * Anthropic API for extraction/classification and nowhere else.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import type { PdfExtractionClient } from "./extraction/extractor";
import type { LlmClassifier, LlmClassification } from "@/core/classification/engine";
import type { TxnForClassification } from "@/core/classification/rules";
import { CHART_OF_ACCOUNTS } from "@/core/chartOfAccounts";
import { parseModelJson } from "./extraction/extractor";

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — extraction/classification unavailable");
  }
  _client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export const CLASSIFICATION_PROMPT_VERSION = "v1";

export function anthropicPdfClient(): PdfExtractionClient {
  return {
    async extract({ pdfBase64, prompt, pageRange }) {
      const pagePrompt = pageRange
        ? `${prompt}\n\nProcess ONLY pages ${pageRange.first} through ${pageRange.last} of this document. Set continues_beyond_these_pages=true if the transaction table continues past page ${pageRange.last}.`
        : prompt;
      const msg = await client().messages.create({
        model: MODEL(),
        max_tokens: 32000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
              },
              { type: "text", text: pagePrompt },
            ],
          },
        ],
      });
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return {
        text,
        model: msg.model,
        inputTokens: msg.usage?.input_tokens,
        outputTokens: msg.usage?.output_tokens,
      };
    },
  };
}

function loadClassificationPrompt(businessType: string | null, entityType: string): string {
  const raw = fs.readFileSync(
    path.join(process.cwd(), "prompts", `classification.${CLASSIFICATION_PROMPT_VERSION}.md`),
    "utf8"
  );
  const idx = raw.indexOf("\n---\n");
  const body = idx >= 0 ? raw.slice(idx + 5).trim() : raw.trim();
  const coa = CHART_OF_ACCOUNTS.map((c) => `${c.code} — ${c.name}${c.note ? ` (${c.note})` : ""}`).join("\n");
  return body
    .replace("{{BUSINESS_TYPE}}", businessType ?? "unknown")
    .replace("{{ENTITY_TYPE}}", entityType)
    .replace("{{CHART_OF_ACCOUNTS}}", coa);
}

/** Batched LLM classifier (§3D layer 2). Returns id → classification. */
export function anthropicClassifier(
  onLog?: (log: { model: string; promptVersion: string; rawResponse: string }) => Promise<void>
): LlmClassifier {
  return async (txns: TxnForClassification[], context) => {
    const out = new Map<string, LlmClassification>();
    const BATCH = 40;
    for (let i = 0; i < txns.length; i += BATCH) {
      const batch = txns.slice(i, i + BATCH);
      const prompt = loadClassificationPrompt(context.businessType, context.entityType);
      const txnList = batch
        .map(
          (t) =>
            `{"id":"${t.id}","date":"${t.date}","description":${JSON.stringify(t.rawDescription)},"amount_cents":${t.amountCents},"direction":"${t.direction}"}`
        )
        .join("\n");
      const msg = await client().messages.create({
        model: MODEL(),
        max_tokens: 8000,
        messages: [{ role: "user", content: `${prompt}\n\nTransactions:\n${txnList}` }],
      });
      const text = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      await onLog?.({ model: msg.model, promptVersion: CLASSIFICATION_PROMPT_VERSION, rawResponse: text });
      try {
        const arr = parseModelJson(text) as {
          id: string;
          category_code: string;
          confidence: "high" | "medium" | "low";
          rationale: string;
        }[];
        for (const item of arr) {
          if (item?.id) {
            out.set(item.id, {
              categoryCode: item.category_code,
              confidence: item.confidence,
              rationale: item.rationale ?? "",
            });
          }
        }
      } catch {
        // Unparseable batch → those txns simply stay unclassified (LOW tier).
        // Loud and localized: the engine flags them; we never guess.
      }
    }
    return out;
  };
}
