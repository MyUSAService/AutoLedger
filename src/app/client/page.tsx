import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getCurrentEngagement, getQuestionnaireForEngagement, getAnswers } from "@/services/clientPortal";
import { coverageCalendar } from "@/core/reconciliation";
import { getLocale } from "@/lib/locale";
import { t } from "@/i18n";
import { ClientTopBar } from "./top-bar";

export const dynamic = "force-dynamic";

export default async function ClientDashboard() {
  const user = await getSessionUser();
  if (!user || user.role !== "CLIENT" || !user.clientId) redirect("/login");

  const engagement = await getCurrentEngagement(user.clientId);
  if (!engagement) redirect("/login");
  const locale = await getLocale(engagement.client.language);

  const questions = await getQuestionnaireForEngagement(engagement.id);
  const answers = await getAnswers(engagement.id);
  const openQuestions = questions.filter((q) => !(q.key in answers)).length;

  const processed = engagement.documents.filter((d) => d.status === "RECONCILED" || d.status === "CLASSIFIED").length;
  const reconciledPeriods = engagement.documents
    .filter((d) => (d.status === "RECONCILED" || d.status === "CLASSIFIED") && d.periodStart && d.periodEnd)
    .map((d) => ({
      periodStart: d.periodStart!.toISOString().slice(0, 10),
      periodEnd: d.periodEnd!.toISOString().slice(0, 10),
    }));
  const calendar = coverageCalendar(reconciledPeriods, engagement.fiscalYear);
  const missing = calendar.filter((m) => !m.covered).map((m) => m.month.slice(5));

  return (
    <div className="max-w-3xl mx-auto">
      <ClientTopBar locale={locale} logoutLabel={t(locale, "common.logout")} />
      <h1 className="text-2xl font-semibold">
        {t(locale, "dash.welcome", { name: engagement.client.businessName })}
      </h1>
      <p className="text-sm text-gray-500 mb-8">{t(locale, "dash.fiscalYear", { year: engagement.fiscalYear })}</p>

      {/* Progress */}
      <section className="grid grid-cols-3 gap-3 mb-8">
        <StatCard label={t(locale, "dash.progress.uploaded")} value={engagement.documents.length} />
        <StatCard label={t(locale, "dash.progress.processed")} value={processed} />
        <StatCard label={t(locale, "dash.progress.questions")} value={openQuestions} highlight={openQuestions > 0} />
      </section>

      {/* Actions */}
      <section className="flex gap-3 mb-10">
        <Link href="/client/upload"
          className="bg-gray-900 text-white px-4 py-2.5 rounded-md text-sm font-medium hover:bg-gray-700">
          {t(locale, "dash.upload.cta")}
        </Link>
        {openQuestions > 0 && (
          <Link href="/client/questions"
            className="bg-amber-500 text-white px-4 py-2.5 rounded-md text-sm font-medium hover:bg-amber-400">
            {t(locale, "dash.questions.count", { count: openQuestions })}
          </Link>
        )}
      </section>

      {/* Coverage */}
      <section className="mb-10">
        <h2 className="font-semibold mb-1">{t(locale, "dash.coverage.title")}</h2>
        <p className="text-xs text-gray-500 mb-3">{t(locale, "dash.coverage.help")}</p>
        <div className="flex gap-1">
          {calendar.map((m) => (
            <div key={m.month}
              className={`flex-1 text-center text-xs py-2 rounded ${
                m.covered ? "bg-green-100 text-green-800" : "bg-red-50 text-red-400 border border-dashed border-red-200"
              }`}>
              {m.month.slice(5)}
            </div>
          ))}
        </div>
        <p className="text-xs mt-2 text-gray-500">
          {missing.length > 0
            ? t(locale, "dash.coverage.missing", { months: missing.join(", ") })
            : t(locale, "dash.coverage.complete")}
        </p>
      </section>

      {/* Documents — plain language statuses only */}
      <section>
        <h2 className="font-semibold mb-3">{t(locale, "dash.title")}</h2>
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {engagement.documents.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{d.originalFilename}</div>
                {d.status === "REJECTED" && d.rejectionReason && (
                  <div className="text-xs text-red-600 mt-0.5">{d.rejectionReason}</div>
                )}
              </div>
              <StatusPill status={d.status} label={t(locale, `status.${d.status}`)} />
            </div>
          ))}
          {engagement.documents.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">—</div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white"}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const good = status === "RECONCILED" || status === "CLASSIFIED";
  const bad = status === "REJECTED";
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
      good ? "bg-green-100 text-green-800" : bad ? "bg-red-100 text-red-800" : "bg-blue-50 text-blue-700"
    }`}>
      {label}
    </span>
  );
}
