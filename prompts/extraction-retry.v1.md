# Prompt: extraction corrective retry
# Version: v1
# Purpose: appended to extraction.v1 when the first pass failed the reconciliation gate
---
IMPORTANT — PREVIOUS ATTEMPT FAILED RECONCILIATION.

Your previous extraction of this statement did not tie:
opening_balance + sum(credits) − sum(debits) differed from closing_balance by {{DISCREPANCY}}.

{{BREAK_HINTS}}

The discrepancy usually means one of:
1. A missed transaction line (check page boundaries, continued tables, and the last line before section breaks).
2. A misread amount (check digit groups: 1,240.00 vs 1,210.00; 8 vs 6; commas vs periods).
3. A summary row wrongly included as a transaction.
4. A debit/credit direction flipped.

Re-extract the COMPLETE statement from scratch with extreme care on amounts and completeness. Return the same JSON schema.
