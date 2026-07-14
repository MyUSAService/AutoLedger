"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateButton({
  engagementId,
  disabled,
  openCount,
}: {
  engagementId: string;
  disabled: boolean;
  openCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function generate() {
    if (
      disabled &&
      !confirm(
        `${openCount} item(s) are still open. They will appear on the Open Items sheet. Generate anyway?`
      )
    )
      return;
    setBusy(true);
    try {
      await fetch(`/api/engagements/${engagementId}/generate`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={generate}
      disabled={busy}
      className={`px-4 py-2 rounded-md text-sm font-medium ${
        disabled
          ? "bg-yellow-100 text-yellow-900 border border-yellow-300 hover:bg-yellow-200"
          : "bg-green-700 text-white hover:bg-green-600"
      } disabled:opacity-50`}
      title={disabled ? `${openCount} open item(s) — they will be listed on the Open Items sheet` : "All clear"}
    >
      {busy ? "Queuing…" : "Approve & Generate workbook"}
    </button>
  );
}
