"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface QueueItem {
  id: string;
  date: string;
  account: string;
  description: string;
  amount: string;
  direction: string;
  categoryCode: string | null;
  confidence: string | null;
  flag: string;
  rationale: string | null;
}

// Kept in sync with src/core/chartOfAccounts.ts (server validates against the real chart).
const CATEGORIES = [
  "INC_SALES", "INC_REFUNDS", "INC_INTEREST", "INC_OTHER",
  "EXP_ADVERTISING", "EXP_BANK_FEES", "EXP_CONTRACTORS", "EXP_INSURANCE", "EXP_LEGAL_ACCT",
  "EXP_MEALS", "EXP_OFFICE", "EXP_PAYROLL_WAGES", "EXP_PAYROLL_TAXES", "EXP_RENT",
  "EXP_REPAIRS", "EXP_PHONE_INTERNET", "EXP_TRAVEL", "EXP_UTILITIES", "EXP_VEHICLE",
  "EXP_SALES_TAX", "EXP_OTHER",
  "NPL_TRANSFER", "NPL_LOAN_PRINCIPAL", "EQ_OWNER_CAPITAL", "EQ_OWNER_DRAWS",
  "BS_LOAN_FROM_OWNER", "BS_FIXED_ASSETS", "NPL_CC_PAYMENT",
];

export function ReviewQueue({ engagementId, items }: { engagementId: string; items: QueueItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [saveRule, setSaveRule] = useState<Record<string, boolean>>({});

  async function reclassify(item: QueueItem) {
    const categoryCode = selections[item.id];
    if (!categoryCode) return;
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/transactions/${item.id}/reclassify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryCode, saveAsRule: !!saveRule[item.id] }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function confirm(item: QueueItem) {
    setBusyId(item.id);
    try {
      const res = await fetch(`/api/transactions/${item.id}/resolve`, { method: "POST" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
        Queue is clear — nothing needs review.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-left text-gray-600">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Account</th>
            <th className="px-3 py-2">Description</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">Flag</th>
            <th className="px-3 py-2">Current / rationale</th>
            <th className="px-3 py-2 w-64">Reclassify</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="px-3 py-2 whitespace-nowrap">{item.date}</td>
              <td className="px-3 py-2 text-xs">{item.account}</td>
              <td className="px-3 py-2 font-mono text-xs max-w-xs break-words">{item.description}</td>
              <td className={`px-3 py-2 whitespace-nowrap ${item.direction === "CREDIT" ? "text-green-700" : ""}`}>
                {item.direction === "CREDIT" ? "+" : "−"}{item.amount}
              </td>
              <td className="px-3 py-2">
                <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-900 text-xs whitespace-nowrap">
                  {item.flag.replace(/_/g, " ")}
                </span>
              </td>
              <td className="px-3 py-2 text-xs text-gray-500 max-w-[180px]">
                {item.categoryCode ?? "unclassified"}
                {item.rationale && <div className="italic">{item.rationale}</div>}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <select
                    className="border border-gray-300 rounded px-1 py-1 text-xs"
                    value={selections[item.id] ?? ""}
                    onChange={(e) => setSelections((s) => ({ ...s, [item.id]: e.target.value }))}
                  >
                    <option value="">— pick category —</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      checked={!!saveRule[item.id]}
                      onChange={(e) => setSaveRule((s) => ({ ...s, [item.id]: e.target.checked }))}
                    />
                    save as rule for this client
                  </label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => reclassify(item)}
                      disabled={!selections[item.id] || busyId === item.id}
                      className="flex-1 bg-gray-900 text-white text-xs rounded px-2 py-1 disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      {busyId === item.id ? "Saving…" : "Apply"}
                    </button>
                    {item.categoryCode && (
                      <button
                        onClick={() => confirm(item)}
                        disabled={busyId === item.id}
                        title="Confirm current classification and resolve the flag"
                        className="flex-1 bg-green-700 text-white text-xs rounded px-2 py-1 disabled:opacity-50"
                      >
                        Confirm
                      </button>
                    )}
                  </div>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
