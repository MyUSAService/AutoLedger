# Altemore Statement Portal — Phase 1

Client bank-statement processing pipeline for the Altemore accounting practice. Clients upload statement PDFs; the system extracts every transaction with Claude PDF vision, enforces a cent-exact reconciliation gate, classifies against a standard chart of accounts, routes every uncertain item to a staff review queue, and produces a preparer-ready Excel workbook.

Design philosophy: errors are LOUD and LOCALIZED, never silent. A rejected document with a clear reason is a success; a plausible-looking wrong number is a failure. When in doubt, flag — never guess.

## Scope shipped

**Phase 1** — staff pipeline: upload → extraction → reconciliation gate → classification → exception-first review queue → versioned Excel workbook.

**Phase 2** — client portal: passwordless magic-link login for clients, password + emailed 6-digit code for staff, bilingual UI (Italian default, EN toggle, all copy in `src/i18n/*.json`), drag-and-drop upload with plain-language statuses, coverage calendar, progress view, and the guided balance-sheet questionnaire (Step E) with plain-language flag resolution. Client answers become PROPOSALS (visible in the staff queue with a one-click Confirm) — nothing is final until staff review. Transactional email via Resend (console fallback in dev).

Phase 3 (remaining): contradiction detection, admin panel for chart/rules, notification emails (upload received / questions waiting / workbook ready).

## Stack

Next.js 15 (App Router) + TypeScript + Tailwind 4, Postgres via Prisma, DB-backed job queue (hosting-agnostic, no Redis), Anthropic API for extraction and classification, exceljs for workbook output, Vitest (82 tests). Storage abstraction ships with a local-disk driver and a Cloudflare R2 / S3 driver.

## Getting started

```bash
cp .env.example .env          # then fill in ANTHROPIC_API_KEY
docker compose up -d          # local Postgres on :5432
npm install
npm run db:push               # create schema
npm run db:seed               # firm, staff user, demo client + FY2025 engagement
npm run dev                   # web UI on http://localhost:3000
npm run worker                # background pipeline worker (separate terminal)
```

Sign-in (after `npm run db:seed`):
- Staff: http://localhost:3000/staff-login — `info@altemore.com` / `altemore-dev-2026` (6-digit code prints to the console until you set RESEND_API_KEY; set SEED_STAFF_PASSWORD in production).
- Client demo: http://localhost:3000/login — `cliente@bellavita.example` (magic link prints to the console).

Then upload PDFs from `tests/fixtures/pdf/` and answer the questionnaire at /client/questions.

## Tests

```bash
npm test                                  # 82 unit + integration tests, no API key needed
npx tsx scripts/live-extraction-check.ts  # end-to-end against the real Anthropic API (needs key)
```

The fixture set covers: two clean statements with an inter-account transfer pair between them, a statement with loan proceeds/payment + large purchase + owner withdrawal + credit card payment, a statement that intentionally fails reconciliation by $120.00, and an invoice that must be rejected as not-a-statement.

## The reconciliation gate (non-negotiable)

For every statement, `opening + credits − debits` must equal the printed closing balance **to the cent**. A failing statement gets exactly one corrective retry with the discrepancy amount and running-balance break localization in the prompt; if it still fails it is marked FAILED RECONCILIATION, shown in red in the staff queue with the exact discrepancy, and its data never reaches the workbook. The arithmetic proof is stored per statement and printed on the Reconciliation Proof sheet.

## Data-flow note (compliance)

Client financial documents are stored encrypted at rest (local disk in dev; R2/S3 with SSE in production) and are sent to exactly one third party: the Anthropic API, for extraction and classification. Every model call is logged with model id, prompt version, and raw response (`ExtractionCall` table). Account numbers are masked to last-4 everywhere — enforced at the extraction schema level, in the database, in the UI, and in the workbook. Every upload, classification change, review action, and workbook generation is written to `AuditLog`.

## Repository layout

```
prisma/schema.prisma        data model (money = integer cents, always)
prompts/                    versioned prompt templates (extraction, retry, classification)
src/core/                   pure domain logic: money, reconciliation, chart of accounts,
                            rules, detectors, classification engine — fully unit-tested
src/services/               extraction (Claude PDF vision), storage, queue, pipeline,
                            workbook computation + exceljs builder, Anthropic adapters
src/worker/                 background job worker (npm run worker)
src/app/                    staff UI + API routes
tests/fixtures/             synthetic statement PDFs + known-good expected JSON
scripts/                    fixture generator (Python), live extraction check
```

## Security notes

Sessions: httpOnly cookies, sha256-hashed server-side, 12h absolute + 60min idle timeout. One-time tokens (magic links, 2FA codes) are stored hashed, single-use, rate-limited (5 links/hour, 5 code attempts). Upload rate limit 30/hour per engagement. Account numbers masked to last-4 end to end. Remaining before public launch: virus scanning on uploads, production password policy, CSP headers.
