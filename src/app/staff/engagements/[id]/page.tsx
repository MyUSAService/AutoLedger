import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { coverageCalendar } from "@/core/reconciliation";
import { formatUsd } from "@/core/money";
import { UploadForm } from "./upload-form";
import { ReviewQueue } from "./review-queue";
import { GenerateButton } from "./generate-button";

export const dynamic = "force-dynamic";

export default async function EngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || (user.role !== "STAFF" && user.role !== "ADMIN")) redirect("/staff-login");
  const { id } = await params;
  const engagement = await db.engagement.findUniqueOrThrow({
    where: { id },
    include: {
      client: true,
      accounts: true,
      documents: { orderBy: { createdAt: "desc" } },
      workbooks: { orderBy: { version: "desc" } },
    },
  });

  const flagged = await db.transaction.findMany({
    where: { engagementId: id, OR: [{ flag: { not: "NONE" }, flagResolved: false }, { categoryCode: null, excludeFromPnl: false }] },
    include: { account: true },
    orderBy: { date: "asc" },
    take: 500,
  });
  const txnCount = await db.transaction.count({ where: { engagementId: id } });
  const jobs = await db.job.findMany({
    where: { status: { in: ["PENDING", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const reconciledPeriods = engagement.documents
    .filter((d) => (d.status === "RECONCILED" || d.status === "CLASSIFIED") && d.periodStart && d.periodEnd)
    .map((d) => ({
      periodStart: d.periodStart!.toISOString().slice(0, 10),
      periodEnd: d.periodEnd!.toISOString().slice(0, 10),
    }));
  const calendar = coverageCalendar(reconciledPeriods, engagement.fiscalYear);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{engagement.client.businessName}</h1>
          <p className="text-sm text-gray-500">
            FY {engagement.fiscalYear} · {engagement.client.entityType.replace(/_/g, " ")} · {engagement.status} ·{" "}
            {txnCount} transactions · {flagged.length} need review
            {txnCount > 0 && ` (${Math.round((flagged.length / txnCount) * 100)}%)`}
          </p>
        </div>
        <GenerateButton engagementId={id} disabled={flagged.length > 0} openCount={flagged.length} />
      </div>

      {jobs.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          {jobs.length} job(s) in progress: {jobs.map((j) => `${j.type} ${j.progress}% ${j.progressLabel ?? ""}`).join(" · ")}
          — refresh for updates.
        </div>
      )}

      {/* Coverage calendar */}
      <section>
        <h2 className="font-semibold mb-2">Coverage — FY {engagement.fiscalYear}</h2>
        <div className="flex gap-1">
          {calendar.map((m) => (
            <div
              key={m.month}
              title={m.month}
              className={`flex-1 text-center text-xs py-2 rounded ${
                m.covered ? "bg-green-100 text-green-800" : "bg-red-50 text-red-400 border border-dashed border-red-200"
              }`}
            >
              {m.month.slice(5)}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Missing months: {calendar.filter((m) => !m.covered).map((m) => m.month.slice(5)).join(", ") || "none"}
        </p>
      </section>

      {/* Statements */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Statements</h2>
          <UploadForm engagementId={id} />
        </div>
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Opening</th>
                <th className="px-3 py-2">Closing</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {engagement.documents.map((d) => {
                const account = engagement.accounts.find((a) => a.id === d.accountId);
                const bad = d.status === "FAILED_RECONCILIATION" || d.status === "REJECTED";
                return (
                  <tr key={d.id} className={bad ? "bg-red-50" : ""}>
                    <td className="px-3 py-2 font-mono text-xs">{d.originalFilename}</td>
                    <td className="px-3 py-2">{account ? `${account.bankName} ****${account.last4}` : "—"}</td>
                    <td className="px-3 py-2">
                      {d.periodStart && d.periodEnd
                        ? `${d.periodStart.toISOString().slice(0, 10)} → ${d.periodEnd.toISOString().slice(0, 10)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{d.openingBalanceCents != null ? formatUsd(d.openingBalanceCents) : "—"}</td>
                    <td className="px-3 py-2">{d.closingBalanceCents != null ? formatUsd(d.closingBalanceCents) : "—"}</td>
                    <td className="px-3 py-2">
                      <DocStatus status={d.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {d.status === "FAILED_RECONCILIATION" && d.reconDiscrepancyCents != null && (
                        <span className="text-red-700 font-medium">
                          off by {formatUsd(d.reconDiscrepancyCents)} after {d.reconAttempts} attempt(s)
                        </span>
                      )}
                      {d.rejectionReason}
                    </td>
                  </tr>
                );
              })}
              {engagement.documents.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                    No statements uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Exception-first review queue */}
      <section>
        <h2 className="font-semibold mb-2">
          Review queue <span className="text-sm font-normal text-gray-500">— flagged items only ({flagged.length})</span>
        </h2>
        <ReviewQueue
          engagementId={id}
          items={flagged.map((t) => ({
            id: t.id,
            date: t.date.toISOString().slice(0, 10),
            account: `${t.account.bankName} ****${t.account.last4}`,
            description: t.rawDescription,
            amount: formatUsd(t.amountCents),
            direction: t.direction,
            categoryCode: t.categoryCode,
            confidence: t.confidence,
            flag: t.flag,
            rationale: t.classifierRationale,
          }))}
        />
      </section>

      {/* Workbooks */}
      {engagement.workbooks.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">Generated workbooks</h2>
          <ul className="text-sm space-y-1">
            {engagement.workbooks.map((w) => (
              <li key={w.id}>
                <a href={`/api/workbooks/${w.id}/download`} className="text-blue-700 hover:underline">
                  Workbook v{w.version}
                </a>{" "}
                <span className="text-gray-400 text-xs">locked {w.lockedAt.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function DocStatus({ status }: { status: string }) {
  const colors: Record<string, string> = {
    RECONCILED: "bg-green-100 text-green-800",
    CLASSIFIED: "bg-green-100 text-green-800",
    FAILED_RECONCILIATION: "bg-red-100 text-red-800",
    REJECTED: "bg-red-100 text-red-800",
    DUPLICATE: "bg-yellow-100 text-yellow-800",
    EXTRACTING: "bg-blue-100 text-blue-800",
    UPLOADED: "bg-gray-100 text-gray-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${colors[status] ?? "bg-gray-100"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
