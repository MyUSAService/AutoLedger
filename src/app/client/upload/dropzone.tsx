"use client";

import { useRef, useState } from "react";

interface FileState {
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function ClientDropzone({
  labels,
}: {
  labels: { dropzone: string; uploading: string; processing: string; error: string };
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileState[]>([]);
  const [dragging, setDragging] = useState(false);

  async function handleFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    for (const file of arr) {
      setFiles((s) => [...s, { name: file.name, status: "uploading" }]);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/client/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setFiles((s) => s.map((f) => (f.name === file.name ? { ...f, status: "error", error: body.error ?? labels.error } : f)));
        } else {
          setFiles((s) => s.map((f) => (f.name === file.name ? { ...f, status: "done" } : f)));
        }
      } catch {
        setFiles((s) => s.map((f) => (f.name === file.name ? { ...f, status: "error", error: labels.error } : f)));
      }
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
          dragging ? "border-gray-900 bg-gray-100" : "border-gray-300 bg-white hover:bg-gray-50"
        }`}
      >
        <p className="text-sm text-gray-500">{labels.dropzone}</p>
        <input ref={inputRef} type="file" accept="application/pdf" multiple hidden
          onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div className="mt-6 space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2.5 text-sm">
              <span className="truncate mr-3">{f.name}</span>
              {f.status === "uploading" && <span className="text-blue-600 text-xs whitespace-nowrap">{labels.uploading}</span>}
              {f.status === "done" && <span className="text-green-600 text-xs">✓</span>}
              {f.status === "error" && <span className="text-red-600 text-xs whitespace-nowrap">{f.error}</span>}
            </div>
          ))}
          {files.some((f) => f.status === "done") && (
            <p className="text-xs text-gray-500 mt-3">{labels.processing}</p>
          )}
        </div>
      )}
    </div>
  );
}
