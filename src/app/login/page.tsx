import { getLocale } from "@/lib/locale";
import { t } from "@/i18n";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await getLocale();
  const { error } = await searchParams;
  return (
    <div className="max-w-md mx-auto mt-12">
      <h1 className="text-2xl font-semibold mb-2">{t(locale, "login.title")}</h1>
      <p className="text-sm text-gray-500 mb-6">{t(locale, "login.subtitle")}</p>
      {error === "invalid" && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm mb-4">
          {t(locale, "login.invalidLink")}
        </div>
      )}
      <LoginForm
        locale={locale}
        labels={{
          email: t(locale, "login.emailLabel"),
          send: t(locale, "login.sendLink"),
          sent: t(locale, "login.linkSent"),
          error: t(locale, "common.error"),
        }}
      />
    </div>
  );
}
