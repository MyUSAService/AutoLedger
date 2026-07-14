#!/usr/bin/env python3
"""
Generates synthetic bank statement PDF fixtures + known-good expected JSON.
Output: tests/fixtures/pdf/*.pdf and tests/fixtures/expected/*.json

Statements are arithmetically consistent (they reconcile to the cent),
except broken_statement.pdf which is intentionally off by $120.00,
and not_a_statement.pdf which is an invoice.
"""
import json
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(ROOT, "tests", "fixtures", "pdf")
EXP_DIR = os.path.join(ROOT, "tests", "fixtures", "expected")
os.makedirs(PDF_DIR, exist_ok=True)
os.makedirs(EXP_DIR, exist_ok=True)


def money(c):
    return f"{c/100:,.2f}"


def build_statement(filename, bank, last4, acct_type, period, opening_cents, txns, style, break_closing_by=0):
    """txns: list of (iso_date, description, amount_cents, direction)"""
    path = os.path.join(PDF_DIR, filename)
    c = canvas.Canvas(path, pagesize=LETTER)
    w, h = LETTER

    balance = opening_cents
    lines = []
    for d, desc, amt, direction in txns:
        balance += amt if direction == "credit" else -amt
        lines.append((d, desc, amt, direction, balance))
    closing = balance + break_closing_by

    y = h - 0.7 * inch
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.7 * inch, y, bank)
    c.setFont("Helvetica", 9)
    y -= 0.25 * inch
    c.drawString(0.7 * inch, y, "Business Complete Checking" if acct_type == "checking" else "Business Savings")
    y -= 0.18 * inch
    c.drawString(0.7 * inch, y, f"Account number: ****{last4}")
    y -= 0.18 * inch
    c.drawString(0.7 * inch, y, f"Statement period: {period[0]} through {period[1]}")

    y -= 0.35 * inch
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.7 * inch, y, "ACCOUNT SUMMARY")
    c.setFont("Helvetica", 9)
    y -= 0.2 * inch
    credits = sum(a for _, _, a, dr in txns if dr == "credit")
    debits = sum(a for _, _, a, dr in txns if dr == "debit")
    for label, val in [
        ("Beginning balance", money(opening_cents)),
        ("Deposits and credits", money(credits)),
        ("Withdrawals and debits", money(debits)),
        ("Ending balance", money(closing)),
    ]:
        c.drawString(0.9 * inch, y, label)
        c.drawRightString(4.2 * inch, y, "$" + val)
        y -= 0.17 * inch

    y -= 0.25 * inch
    c.setFont("Helvetica-Bold", 10)
    c.drawString(0.7 * inch, y, "TRANSACTION DETAIL")
    y -= 0.22 * inch
    c.setFont("Helvetica-Bold", 8)
    if style == "two_col":
        headers = [("Date", 0.7), ("Description", 1.5), ("Deposits", 5.1), ("Withdrawals", 6.1), ("Balance", 7.1)]
    else:
        headers = [("Date", 0.7), ("Description", 1.5), ("Amount", 5.6), ("Balance", 7.1)]
    for text, x in headers:
        c.drawString(x * inch, y, text)
    y -= 0.05 * inch
    c.line(0.7 * inch, y, 7.8 * inch, y)
    y -= 0.15 * inch
    c.setFont("Helvetica", 8)

    for d, desc, amt, direction, bal in lines:
        if y < 0.8 * inch:
            c.showPage()
            y = h - 0.8 * inch
            c.setFont("Helvetica", 8)
        mmdd = f"{d[5:7]}/{d[8:10]}"
        c.drawString(0.7 * inch, y, mmdd)
        c.drawString(1.5 * inch, y, desc[:52])
        if style == "two_col":
            if direction == "credit":
                c.drawRightString(5.9 * inch, y, money(amt))
            else:
                c.drawRightString(6.9 * inch, y, money(amt))
        else:
            sign = "" if direction == "credit" else "-"
            c.drawRightString(6.3 * inch, y, f"{sign}{money(amt)}")
        c.drawRightString(7.8 * inch, y, money(bal))
        y -= 0.16 * inch

    y -= 0.2 * inch
    c.setFont("Helvetica-Bold", 9)
    c.drawString(0.7 * inch, y, f"Ending balance on {period[1]}: ${money(closing)}")
    c.save()

    expected = {
        "is_bank_statement": True,
        "bank_name": bank,
        "account_last4": last4,
        "account_type": acct_type,
        "currency": "USD",
        "period_start": period[0],
        "period_end": period[1],
        "opening_balance": f"{opening_cents/100:.2f}",
        "closing_balance": f"{closing/100:.2f}",
        "lines": [
            {"date": d, "description": desc, "amount": f"{amt/100:.2f}", "direction": dr, "running_balance": f"{bal/100:.2f}"}
            for d, desc, amt, dr, bal in lines
        ],
        "continues_beyond_these_pages": False,
    }
    with open(os.path.join(EXP_DIR, filename.replace(".pdf", ".json")), "w") as f:
        json.dump(expected, f, indent=2)
    print(f"wrote {filename}: {len(lines)} txns, closing {money(closing)}")


# ---------- Fixture 1: Chase checking, Jan 2025 — clean, busy month ----------
chase_txns = [
    ("2025-01-02", "STRIPE TRANSFER ST-A1B2C3 PAYOUT", 482500, "credit"),
    ("2025-01-03", "GOOGLE ADS 7534218890 CC@GOOGLE.COM", 35000, "debit"),
    ("2025-01-06", "SHOPIFY PAYOUT 44213", 291075, "credit"),
    ("2025-01-07", "MONTHLY SERVICE FEE", 1500, "debit"),
    ("2025-01-08", "FACEBK ADS T2X8W1 META PLATFORMS", 42050, "debit"),
    ("2025-01-09", "CHECK # 1042", 120000, "debit"),
    ("2025-01-10", "COMCAST BUSINESS 8774 INTERNET", 14999, "debit"),
    ("2025-01-13", "STRIPE TRANSFER ST-D4E5F6 PAYOUT", 517560, "credit"),
    ("2025-01-14", "USPS PO 4459087713 SHIPPING", 8745, "debit"),
    ("2025-01-15", "GUSTO PAYROLL 6SNJ2 NET PAY", 385000, "debit"),
    ("2025-01-15", "IRS USATAXPYMT 220115 EFTPS", 98213, "debit"),
    ("2025-01-16", "AMAZON MKTPL US*RT4Y77 SUPPLIES", 15321, "debit"),
    ("2025-01-17", "ONLINE TRANSFER TO SAV ****9921 CONF# 88213", 200000, "debit"),
    ("2025-01-21", "STRIPE TRANSFER ST-G7H8I9 PAYOUT", 448090, "credit"),
    ("2025-01-22", "FL DEPT REVENUE SALES TAX 0125", 61240, "debit"),
    ("2025-01-23", "LANDLORD PROPERTIES LLC RENT JAN", 250000, "debit"),
    ("2025-01-24", "CHASE CARD AUTOPAY 4412 EPAY", 187343, "debit"),
    ("2025-01-27", "MOBILE DEPOSIT REF 82231", 150000, "credit"),
    ("2025-01-28", "STRIPE TRANSFER ST-J1K2L3 PAYOUT", 395420, "credit"),
    ("2025-01-30", "WIRE TRANSFER FEE", 2500, "debit"),
    ("2025-01-31", "INTEREST PAYMENT", 312, "credit"),
]
build_statement(
    "chase_checking_2025-01.pdf", "JPMorgan Chase Bank, N.A.", "4821", "checking",
    ("2025-01-01", "2025-01-31"), 1245030, chase_txns, "two_col",
)

# ---------- Fixture 2: Chase savings, Jan 2025 — receives the transfer ----------
savings_txns = [
    ("2025-01-17", "ONLINE TRANSFER FROM CHK ****4821 CONF# 88213", 200000, "credit"),
    ("2025-01-31", "INTEREST PAYMENT", 875, "credit"),
]
build_statement(
    "chase_savings_2025-01.pdf", "JPMorgan Chase Bank, N.A.", "9921", "savings",
    ("2025-01-01", "2025-01-31"), 3500000, savings_txns, "two_col",
)

# ---------- Fixture 3: Bank of America, Feb 2025 — loan + large purchase ----------
bofa_txns = [
    ("2025-02-03", "STRIPE TRANSFER ST-M4N5O6 PAYOUT", 512280, "credit"),
    ("2025-02-04", "SBA LOAN PROCEEDS DISBURSEMENT 5512", 2500000, "credit"),
    ("2025-02-05", "DELL MARKETING LP EQUIPMENT INV88231", 389900, "debit"),
    ("2025-02-06", "GOOGLE ADS 7534218890", 40000, "debit"),
    ("2025-02-10", "STRIPE TRANSFER ST-P7Q8R9 PAYOUT", 461155, "credit"),
    ("2025-02-11", "ZELLE TO MARCO ROSSI", 100000, "debit"),
    ("2025-02-14", "GUSTO PAYROLL 7TKL3 NET PAY", 385000, "debit"),
    ("2025-02-14", "IRS USATAXPYMT 220214 EFTPS", 98213, "debit"),
    ("2025-02-18", "LANDLORD PROPERTIES LLC RENT FEB", 250000, "debit"),
    ("2025-02-20", "SBA LOAN PAYMENT 5512", 55000, "debit"),
    ("2025-02-24", "STRIPE TRANSFER ST-S1T2U3 PAYOUT", 478830, "credit"),
    ("2025-02-25", "FL DEPT REVENUE SALES TAX 0225", 58110, "debit"),
    ("2025-02-26", "AMEX EPAYMENT ACH PMT M1234", 215600, "debit"),
    ("2025-02-28", "MAINTENANCE FEE", 1695, "debit"),
]
build_statement(
    "bofa_checking_2025-02.pdf", "Bank of America, N.A.", "7702", "checking",
    ("2025-02-01", "2025-02-28"), 2358947, bofa_txns, "one_col",
)

# ---------- Fixture 4: Wells Fargo, Mar 2025 — INTENTIONALLY BROKEN ----------
wells_txns = [
    ("2025-03-03", "STRIPE TRANSFER ST-V4W5X6 PAYOUT", 448210, "credit"),
    ("2025-03-05", "GOOGLE ADS 7534218890", 38000, "debit"),
    ("2025-03-10", "GUSTO PAYROLL 8ULM4 NET PAY", 385000, "debit"),
    ("2025-03-17", "STRIPE TRANSFER ST-Y7Z8A9 PAYOUT", 502110, "credit"),
    ("2025-03-20", "LANDLORD PROPERTIES LLC RENT MAR", 250000, "debit"),
    ("2025-03-28", "MONTHLY SERVICE FEE", 1000, "debit"),
]
# printed ending balance is $120.00 HIGHER than the arithmetic → must fail the gate
build_statement(
    "wells_broken_2025-03.pdf", "Wells Fargo Bank, N.A.", "3315", "checking",
    ("2025-03-01", "2025-03-31"), 1810450, wells_txns, "one_col", break_closing_by=12000,
)

# ---------- Fixture 5: not a bank statement (an invoice) ----------
path = os.path.join(PDF_DIR, "not_a_statement.pdf")
c = canvas.Canvas(path, pagesize=LETTER)
w, h = LETTER
c.setFont("Helvetica-Bold", 18)
c.drawString(0.8 * inch, h - 1 * inch, "INVOICE #2025-0342")
c.setFont("Helvetica", 10)
c.drawString(0.8 * inch, h - 1.4 * inch, "Northstar Pixel LLC — Architectural Renderings")
c.drawString(0.8 * inch, h - 1.7 * inch, "Bill to: Bella Vita Imports LLC")
c.drawString(0.8 * inch, h - 2.1 * inch, "3D exterior rendering package ........... $2,400.00")
c.drawString(0.8 * inch, h - 2.35 * inch, "Revision round ........................... $350.00")
c.setFont("Helvetica-Bold", 11)
c.drawString(0.8 * inch, h - 2.8 * inch, "TOTAL DUE: $2,750.00")
c.save()
print("wrote not_a_statement.pdf (invoice)")

print("done")
