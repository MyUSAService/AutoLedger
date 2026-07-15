import { cookies } from "next/headers";
import { DEFAULT_LOCALE, type Locale } from "@/i18n";

export const LOCALE_COOKIE = "altemore_locale";

export async function getLocale(fallback?: string | null): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (c === "it" || c === "en") return c;
  if (fallback === "it" || fallback === "en") return fallback;
  return DEFAULT_LOCALE;
}
