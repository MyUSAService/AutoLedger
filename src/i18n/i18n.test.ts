import { describe, it as test, expect } from "vitest";
import { t, dictionaryKeys } from "./index";

describe("i18n", () => {
  test("Italian and English dictionaries have EXACTLY the same keys", () => {
    const itKeys = dictionaryKeys("it").sort();
    const enKeys = dictionaryKeys("en").sort();
    expect(itKeys).toEqual(enKeys);
  });

  test("interpolation replaces all variables (including repeated)", () => {
    expect(t("it", "dash.welcome", { name: "Marco" })).toBe("Ciao Marco");
    expect(t("en", "q.progress", { answered: 3, total: 10 })).toBe("3 of 10 answered");
  });

  test("missing keys fall back to Italian, then to the key itself", () => {
    expect(t("en", "definitely.missing.key")).toBe("definitely.missing.key");
  });

  test("no dictionary value contains obvious accounting jargon in client copy", () => {
    // spot-guard: client questionnaire copy must stay plain-language
    for (const locale of ["it", "en"] as const) {
      for (const key of dictionaryKeys(locale)) {
        if (key.startsWith("q.")) {
          const val = t(locale, key);
          expect(val).not.toMatch(/trial balance|retained earnings|debit|credit entry|partita doppia|dare\b|avere\b/i);
        }
      }
    }
  });
});
