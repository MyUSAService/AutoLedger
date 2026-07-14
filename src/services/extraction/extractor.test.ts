import { describe, it, expect } from "vitest";
import { extractStatement, toReconInput, parseModelJson, type PdfExtractionClient } from "./extractor";
import { ExtractionResultSchema, validateStatementAnchors, mergeChunks, type ExtractionResult } from "./schema";

const goodStatement: ExtractionResult = {
  is_bank_statement: true,
  bank_name: "Chase",
  account_last4: "4821",
  account_type: "checking",
  currency: "USD",
  period_start: "2025-01-01",
  period_end: "2025-01-31",
  opening_balance: "1000.00",
  closing_balance: "1250.00",
  lines: [
    { date: "2025-01-05", description: "STRIPE PAYOUT", amount: "500.00", direction: "credit", running_balance: "1500.00" },
    { date: "2025-01-10", description: "RENT", amount: "250.00", direction: "debit", running_balance: "1250.00" },
  ],
  continues_beyond_these_pages: false,
};

const stubClient = (responses: string[]): PdfExtractionClient => {
  let call = 0;
  return {
    async extract() {
      const text = responses[Math.min(call, responses.length - 1)];
      call++;
      return { text, model: "stub-model" };
    },
  };
};

describe("ExtractionResultSchema", () => {
  it("accepts a valid extraction", () => {
    expect(() => ExtractionResultSchema.parse(goodStatement)).not.toThrow();
  });
  it("rejects a full account number — masking is enforced at the schema level", () => {
    expect(() =>
      ExtractionResultSchema.parse({ ...goodStatement, account_last4: "123456789" })
    ).toThrow();
  });
  it("rejects malformed dates and amounts", () => {
    expect(() =>
      ExtractionResultSchema.parse({
        ...goodStatement,
        lines: [{ date: "01/05/2025", description: "X", amount: "500.00", direction: "credit", running_balance: null }],
      })
    ).toThrow();
    expect(() =>
      ExtractionResultSchema.parse({
        ...goodStatement,
        lines: [{ date: "2025-01-05", description: "X", amount: "five hundred", direction: "credit", running_balance: null }],
      })
    ).toThrow();
  });
});

describe("validateStatementAnchors — Step A rejection", () => {
  it("passes a complete statement", () => {
    expect(validateStatementAnchors(goodStatement).ok).toBe(true);
  });
  it("rejects non-statements with bilingual reasons", () => {
    const v = validateStatementAnchors({ ...goodStatement, is_bank_statement: false });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasonEn).toContain("bank statement");
      expect(v.reasonIt).toContain("estratto conto");
    }
  });
  it("names exactly what is missing", () => {
    const v = validateStatementAnchors({ ...goodStatement, opening_balance: null, account_last4: null });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reasonEn).toContain("opening balance");
      expect(v.reasonEn).toContain("account number");
      expect(v.reasonEn).not.toContain("closing balance");
    }
  });
});

describe("mergeChunks", () => {
  it("concatenates lines and takes closing data from the last chunk", () => {
    const chunk1: ExtractionResult = { ...goodStatement, closing_balance: null, lines: [goodStatement.lines[0]], continues_beyond_these_pages: true };
    const chunk2: ExtractionResult = { ...goodStatement, opening_balance: null, lines: [goodStatement.lines[1]], continues_beyond_these_pages: false };
    const merged = mergeChunks([chunk1, chunk2]);
    expect(merged.lines).toHaveLength(2);
    expect(merged.opening_balance).toBe("1000.00");
    expect(merged.closing_balance).toBe("1250.00");
  });
});

describe("parseModelJson", () => {
  it("strips markdown fences defensively", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("extractStatement — gate integration", () => {
  it("returns ok on first pass when reconciliation ties", async () => {
    const outcome = await extractStatement(stubClient([JSON.stringify(goodStatement)]), "cGRm", { pageCount: 1 });
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.proof.ties).toBe(true);
      expect(outcome.attempts).toBe(1);
      expect(outcome.logs).toHaveLength(1);
      expect(outcome.logs[0].promptVersion).toBe("v1");
    }
  });

  it("retries ONCE with corrective prompt, succeeds when retry ties", async () => {
    const broken = { ...goodStatement, lines: [goodStatement.lines[0]] }; // missing the rent debit
    const outcome = await extractStatement(
      stubClient([JSON.stringify(broken), JSON.stringify(goodStatement)]),
      "cGRm",
      { pageCount: 1 }
    );
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.attempts).toBe(2);
      expect(outcome.logs.map((l) => l.purpose)).toEqual(["extraction", "extraction_retry"]);
    }
  });

  it("fails LOUDLY after retry still does not tie — never flows downstream", async () => {
    const broken = { ...goodStatement, lines: [goodStatement.lines[0]] };
    const outcome = await extractStatement(
      stubClient([JSON.stringify(broken), JSON.stringify(broken)]),
      "cGRm",
      { pageCount: 1 }
    );
    expect(outcome.status).toBe("failed_reconciliation");
    if (outcome.status === "failed_reconciliation") {
      expect(outcome.proof.ties).toBe(false);
      expect(outcome.proof.discrepancyCents).toBe(25000); // the missing $250 debit, shown to staff
      expect(outcome.attempts).toBe(2);
    }
  });

  it("chunks long statements and merges", async () => {
    const chunk1 = { ...goodStatement, closing_balance: null, lines: [goodStatement.lines[0]], continues_beyond_these_pages: true };
    const chunk2 = { ...goodStatement, lines: [goodStatement.lines[1]], continues_beyond_these_pages: false };
    let calls = 0;
    const client: PdfExtractionClient = {
      async extract({ pageRange }) {
        calls++;
        expect(pageRange).toBeDefined();
        return { text: JSON.stringify(calls === 1 ? chunk1 : chunk2), model: "stub" };
      },
    };
    const outcome = await extractStatement(client, "cGRm", { pageCount: 16, maxPagesPerChunk: 8 });
    expect(calls).toBe(2);
    expect(outcome.status).toBe("ok");
  });

  it("surfaces invalid JSON as its own failure mode", async () => {
    const outcome = await extractStatement(stubClient(["this is not json at all"]), "cGRm", { pageCount: 1 });
    expect(outcome.status).toBe("invalid_json");
  });
});

describe("toReconInput", () => {
  it("converts decimal strings to integer cents", () => {
    const recon = toReconInput(goodStatement);
    expect(recon.openingBalanceCents).toBe(100000);
    expect(recon.lines[0].amountCents).toBe(50000);
    expect(recon.lines[0].runningBalanceCents).toBe(150000);
  });
});
