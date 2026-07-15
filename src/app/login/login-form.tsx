"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({
  locale,
  labels,
}: {
  locale: "it" | "en";
  labels: { email: string; send: string; sent: string; error: string };
}) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    try {
      const res = await fetch("/api/auth/client/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  async function switchLocale(l: "it" | "en") {
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    });
    router.refresh();
  }

  return (
    <div>
      {state === "sent" ? (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 text-sm">{labels.sent}</div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">{labels.email}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
              placeholder="nome@azienda.com"
            />
          </div>
          {state === "error" && <p className="text-sm text-red-600">{labels.error}</p>}
          <button
            type="submit"
            disabled={state === "busy"}
            className="w-full bg-gray-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-gray-700 disabled:opacity-50"
          >
            {labels.send}
          </button>
        </form>
      )}
      <div className="flex gap-2 justify-center mt-8 text-xs text-gray-400">
        <button onClick={() => switchLocale("it")} className={locale === "it" ? "font-bold text-gray-700" : "hover:underline"}>
          Italiano
        </button>
        ·
        <button onClick={() => switchLocale("en")} className={locale === "en" ? "font-bold text-gray-700" : "hover:underline"}>
          English
        </button>
      </div>
    </div>
  );
}
