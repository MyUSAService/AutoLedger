/**
 * Excel workbook builder (§3G) — exceljs. English only. 7 sheets.
 * Clean styling, frozen headers, number formats, NO merged cells in data ranges.
 */

import ExcelJS from "exceljs";
import {
  buildPnl,
  buildTrialBalance,
  buildOpenItems,
  netIncomeCents,
  type WbTxn,
  type BalanceSheetLine,
  type ReconProofRow,
} from "./compute";

export interface WorkbookInput {
  clientName: string;
  entityType: string;
  ein: string | null;
  fiscalYear: number;
  reviewerName: string;
  reviewStatus: string;
  version: number;
  transactions: WbTxn[];
  balanceSheet: BalanceSheetLine[];
  reconProofs: ReconProofRow[];
  failedDocs: { label: string; discrepancyCents: number }[];
  unansweredQuestions: string[];
}

const MONEY_FMT = '#,##0.00;[Red](#,##0.00)';
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const $ = (cents: number) => cents / 100;

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.fill = HEADER_FILL;
    c.font = HEADER_FONT;
    c.alignment = { vertical: "middle" };
  });
  row.height = 20;
}

export async function buildWorkbook(input: WorkbookInput): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Altemore Statement Portal";
  wb.created = new Date();

  const pnl = buildPnl(input.transactions, input.fiscalYear);

  // ---------- 1. Cover ----------
  const cover = wb.addWorksheet("Cover");
  cover.columns = [{ width: 28 }, { width: 50 }];
  const coverRows: [string, string][] = [
    ["Client", input.clientName],
    ["Entity type", input.entityType.replace(/_/g, " ")],
    ["EIN", input.ein ?? "not provided"],
    ["Fiscal year", String(input.fiscalYear)],
    ["Basis", "Cash"],
    ["Preparation date", new Date().toISOString().slice(0, 10)],
    ["Review status", input.reviewStatus],
    ["Staff reviewer", input.reviewerName],
    ["Workbook version", `v${input.version}`],
  ];
  cover.addRow(["ALTEMORE — PREPARER WORKBOOK", ""]).font = { bold: true, size: 16 };
  cover.addRow(["", ""]);
  for (const [k, v] of coverRows) {
    const r = cover.addRow([k, v]);
    r.getCell(1).font = { bold: true };
  }

  // ---------- 2. Income Statement ----------
  const is = wb.addWorksheet("Income Statement", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  is.columns = [{ width: 34 }, ...MONTHS.map(() => ({ width: 11 })), { width: 13 }];
  styleHeader(is.addRow(["Category", ...MONTHS, "Total"]));

  const addPnlSection = (section: "income" | "expense", title: string) => {
    const rows = pnl.filter((r) => r.section === section);
    const titleRow = is.addRow([title, ...Array(13).fill("")]);
    titleRow.getCell(1).font = { bold: true };
    let subtotal = Array(13).fill(0);
    for (const r of rows) {
      const excelRow = is.addRow([`  ${r.label}`, ...r.monthly.map($), $(r.totalCents)]);
      for (let c = 2; c <= 14; c++) excelRow.getCell(c).numFmt = MONEY_FMT;
      r.monthly.forEach((m, i) => (subtotal[i] += m));
      subtotal[12] += r.totalCents;
    }
    const st = is.addRow([`Total ${title}`, ...subtotal.map($)]);
    st.font = { bold: true };
    for (let c = 2; c <= 14; c++) st.getCell(c).numFmt = MONEY_FMT;
    return subtotal;
  };
  const incomeTotals = addPnlSection("income", "Income");
  is.addRow([]);
  const expenseTotals = addPnlSection("expense", "Expenses");
  is.addRow([]);
  const net = is.addRow(["NET INCOME (cash basis)", ...incomeTotals.map((v, i) => $(v - expenseTotals[i]))]);
  net.font = { bold: true };
  for (let c = 2; c <= 14; c++) net.getCell(c).numFmt = MONEY_FMT;

  // ---------- 3. Balance Sheet ----------
  const bs = wb.addWorksheet("Balance Sheet", { views: [{ state: "frozen", ySplit: 1 }] });
  bs.columns = [{ width: 38 }, { width: 15 }, { width: 26 }];
  styleHeader(bs.addRow(["Line item", `As of 12/31/${input.fiscalYear}`, "Source"]));
  for (const line of input.balanceSheet) {
    const r = bs.addRow([line.label, $(line.amountCents), line.source]);
    r.getCell(2).numFmt = MONEY_FMT;
    r.getCell(3).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  // ---------- 4. Trial Balance ----------
  const tb = wb.addWorksheet("Trial Balance", { views: [{ state: "frozen", ySplit: 1 }] });
  tb.columns = [{ width: 38 }, { width: 15 }, { width: 15 }];
  styleHeader(tb.addRow(["Account", "Debit", "Credit"]));
  const tbRows = buildTrialBalance(pnl, input.balanceSheet);
  let tbD = 0, tbC = 0;
  for (const row of tbRows) {
    const r = tb.addRow([row.label, row.debitCents ? $(row.debitCents) : null, row.creditCents ? $(row.creditCents) : null]);
    r.getCell(2).numFmt = MONEY_FMT;
    r.getCell(3).numFmt = MONEY_FMT;
    tbD += row.debitCents;
    tbC += row.creditCents;
  }
  const tbTotal = tb.addRow(["TOTAL", $(tbD), $(tbC)]);
  tbTotal.font = { bold: true };
  tbTotal.getCell(2).numFmt = MONEY_FMT;
  tbTotal.getCell(3).numFmt = MONEY_FMT;

  // ---------- 5. Transaction Detail ----------
  const td = wb.addWorksheet("Transaction Detail", { views: [{ state: "frozen", ySplit: 1 }] });
  td.columns = [
    { width: 11 }, { width: 20 }, { width: 46 }, { width: 12 }, { width: 9 },
    { width: 28 }, { width: 11 }, { width: 10 }, { width: 22 }, { width: 8 },
  ];
  styleHeader(td.addRow(["Date", "Account", "Description", "Amount", "Dir", "Category", "Confidence", "By", "Flag", "P&L"]));
  td.autoFilter = "A1:J1";
  const sorted = [...input.transactions].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    const r = td.addRow([
      t.date,
      t.accountLabel,
      t.rawDescription,
      $(t.amountCents),
      t.direction.toUpperCase(),
      t.categoryCode ?? "UNCLASSIFIED",
      t.confidence ?? "",
      t.classifiedBy ?? "",
      t.flag === "NONE" ? "" : t.flag + (t.flagResolved ? " (resolved)" : ""),
      t.excludeFromPnl ? "excluded" : "yes",
    ]);
    r.getCell(4).numFmt = MONEY_FMT;
    if (t.flag !== "NONE" && !t.flagResolved) {
      r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } }));
    }
    if (!t.categoryCode && !t.excludeFromPnl) {
      r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFECACA" } }));
    }
  }

  // ---------- 6. Reconciliation Proof ----------
  const rp = wb.addWorksheet("Reconciliation Proof", { views: [{ state: "frozen", ySplit: 1 }] });
  rp.columns = [
    { width: 20 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 16 }, { width: 15 }, { width: 14 }, { width: 20 }, { width: 9 },
  ];
  styleHeader(rp.addRow(["Account", "From", "To", "Opening", "+ Credits", "− Debits", "= Computed", "Stated closing", "Discrepancy", "Status", "Attempts"]));
  for (const p of input.reconProofs) {
    const r = rp.addRow([
      p.accountLabel, p.periodStart, p.periodEnd,
      $(p.openingCents), $(p.creditsCents), $(p.debitsCents),
      $(p.computedClosingCents), $(p.statedClosingCents), $(p.discrepancyCents),
      p.status, p.attempts,
    ]);
    for (let c = 4; c <= 9; c++) r.getCell(c).numFmt = MONEY_FMT;
    if (p.discrepancyCents !== 0) {
      r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFECACA" } }));
    }
  }

  // ---------- 7. Open Items — never hidden, never silently empty ----------
  const oi = wb.addWorksheet("Open Items", { views: [{ state: "frozen", ySplit: 1 }] });
  oi.columns = [{ width: 26 }, { width: 28 }, { width: 64 }, { width: 10 }];
  styleHeader(oi.addRow(["Type", "Reference", "Description", "Severity"]));
  const openItems = buildOpenItems(input.transactions, input.failedDocs, pnl, input.unansweredQuestions);
  if (openItems.length === 0) {
    oi.addRow(["NONE", "—", "There are zero open items. All statements reconciled and all flags were resolved by staff.", "—"]);
  } else {
    for (const item of openItems) {
      const r = oi.addRow([item.kind, item.reference, item.description, item.severity.toUpperCase()]);
      if (item.severity === "high") {
        r.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFECACA" } }));
      }
    }
  }

  return wb.xlsx.writeBuffer();
}
