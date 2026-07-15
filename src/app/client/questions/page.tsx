import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getCurrentEngagement } from "@/services/clientPortal";
import { getLocale } from "@/lib/locale";
import { t } from "@/i18n";
import { QuestionnaireWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function QuestionsPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "CLIENT" || !user.clientId) redirect("/login");
  const engagement = await getCurrentEngagement(user.clientId);
  if (!engagement) redirect("/login");
  const locale = await getLocale(engagement.client.language);

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/client" className="text-sm text-gray-400 hover:underline">← {t(locale, "common.back")}</Link>
      <QuestionnaireWizard
        labels={{
          save: t(locale, "common.save"),
          saved: t(locale, "common.saved"),
          skip: t(locale, "common.skip"),
          yes: t(locale, "common.yes"),
          no: t(locale, "common.no"),
          continue: t(locale, "common.continue"),
          loading: t(locale, "common.loading"),
          error: t(locale, "common.error"),
          lender: t(locale, "q.loans.lender"),
          originalAmount: t(locale, "q.loans.originalAmount"),
          currentBalance: t(locale, "q.loans.currentBalance"),
          monthlyPayment: t(locale, "q.loans.monthlyPayment"),
          rate: t(locale, "q.loans.rate"),
        }}
      />
    </div>
  );
}
