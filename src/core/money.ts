/**
 * Money utilities. ALL money in this codebase is integer cents.
 * Floats are forbidden for monetary values — parsing converts immediately.
 */

/** Parse a decimal string like "1,234.56" or "-45.00" or "(45.00)" into integer cents. Throws on ambiguity. */
export function parseCents(input: string): number {
  let s = input.trim();
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`Unparseable monetary value: "${input}"`);
  }
  const [whole, frac = "0"] = s.split(".");
  const cents = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0"), 10);
  return negative ? -cents : cents;
}

/** Format integer cents as "1,234.56" (no currency symbol). */
export function formatCents(cents: number | bigint): string {
  const n = typeof cents === "bigint" ? cents : BigInt(Math.round(cents));
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeStr}.${frac}`;
}

/** Format as dollars for UI, e.g. "$1,234.56" / "-$45.00". */
export function formatUsd(cents: number | bigint): string {
  const s = formatCents(cents);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}
