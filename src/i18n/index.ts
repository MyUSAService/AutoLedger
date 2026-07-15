/**
 * Minimal i18n. All client-facing copy lives in the JSON resource files so the
 * firm can edit wording without touching code (§8). Italian is the default.
 */
import it from "./it.json";
import en from "./en.json";

export type Locale = "it" | "en";
export const LOCALES: Locale[] = ["it", "en"];
export const DEFAULT_LOCALE: Locale = "it";

const dictionaries: Record<Locale, Record<string, string>> = { it, en };

export function t(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let str = dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}

export function dictionaryKeys(locale: Locale): string[] {
  return Object.keys(dictionaries[locale]);
}
