import { db } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function StaffDashboard() {
  const engagements = await db.engagement.findMany({
    include: {
      client: true,
      documents: true,
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Engagements</h1>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">FY</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Statements</th>
              <th className="px-4 py-3">Failed recon</th>
              <th className="px-4 py-3">Transactions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {engagements.map((e) => {
              const failed = e.documents.filter((d) => d.status === "FAILED_RECONCILIATION").length;
              return (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link href={`/staff/engagements/${e.id}`} className="text-blue-700 font-medium hover:underline">
                      {e.client.businessName}
                    </Link>
                    <span className="ml-2 text-xs text-gray-400">{e.client.entityType.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-4 py-3">{e.fiscalYear}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-4 py-3">{e.documents.length}</td>
                  <td className="px-4 py-3">
                    {failed > 0 ? <span className="text-red-600 font-semibold">{failed}</span> : "0"}
                  </td>
                  <td className="px-4 py-3">{e._count.transactions}</td>
                </tr>
              );
            })}
            {engagements.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No engagements yet. Run <code className="bg-gray-100 px-1 rounded">npm run db:seed</code> to create sample data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    OPEN: "bg-blue-100 text-blue-800",
    IN_REVIEW: "bg-yellow-100 text-yellow-800",
    RELEASED: "bg-green-100 text-green-800",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-gray-100"}`}>{status}</span>;
}
