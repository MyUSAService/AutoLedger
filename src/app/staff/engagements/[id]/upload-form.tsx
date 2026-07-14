"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ engagementId }: { engagementId: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onChange() {
    const files = fileRef.current?.files;
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/engagements/${engagementId}/upload`, { method: "POST", body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <label className={`cursor-pointer text-sm px-3 py-1.5 rounded-md ${busy ? "bg-gray-200 text-gray-400" : "bg-gray-900 text-white hover:bg-gray-700"}`}>
        {busy ? "Uploading…" : "Upload statement PDFs"}
        <input ref={fileRef} type="file" accept="application/pdf" multiple hidden onChange={onChange} disabled={busy} />
      </label>
    </div>
  );
}
