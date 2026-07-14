/**
 * Live extraction check against the real Anthropic API using the fixture PDFs.
 * Requires ANTHROPIC_API_KEY. Run: npx tsx scripts/live-extraction-check.ts
 *
 * Proves acceptance criterion 1 end-to-end: every fixture must either
 * reconcile to the cent or fail loudly with the expected discrepancy.
 */
import fs from "fs";
import path from "path";
import { extractStatement } from "../src/services/extraction/extractor";
import { validateStatementAnchors } from "../src/services/extraction/schema";
import { anthropicPdfClient } from "../src/services/anthropic";
import { formatCents } from "../src/core/money";

const FIXTURES = [
  { file: "chase_checking_2025-01.pdf", expect: "ok" },
  { file: "chase_savings_2025-01.pdf", expect: "ok" },
  { file: "bofa_checking_2025-02.pdf", expect: "ok" },
  { file: "wells_broken_2025-03.pdf", expect: "failed_reconciliation" },
  { file: "not_a_statement.pdf", expect: "rejected" },
] as const;

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set — aborting.");
    process.exit(1);
  }
  const dir = path.join(process.cwd(), "tests", "fixtures", "pdf");
  let failures = 0;

  for (const { file, expect } of FIXTURES) {
    const pdf = fs.readFileSync(path.join(dir, file));
    process.stdout.write(`${file} ... `);
    const outcome = await extractStatement(anthropicPdfClient(), pdf.toString("base64"), { pageCount: 2 });

    let actual: string;
    if (outcome.status === "invalid_json") {
      actual = "invalid_json";
    } else if (!validateStatementAnchors(outcome.result).ok) {
      actual = "rejected";
    } else {
      actual = outcome.status;
    }

    const pass = actual === expect;
    if (!pass) failures++;
    const detail =
      outcome.status !== "invalid_json" && outcome.status === "failed_reconciliation"
        ? ` (discrepancy ${formatCents(outcome.proof.discrepancyCents)}, attempts ${outcome.attempts})`
        : outcome.status === "ok"
          ? ` (tied to the cent, ${outcome.result.lines.length} txns, attempts ${outcome.attempts})`
          : "";
    console.log(`${pass ? "PASS" : "FAIL"} — got ${actual}, expected ${expect}${detail}`);
  }

  console.log(failures === 0 ? "\nAll live extraction checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
