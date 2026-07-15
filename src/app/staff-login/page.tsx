"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StaffLoginPage() {
  const [step, setStep] = useState<"password" | "code">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const [emailFailed, setEmailFailed] = useState(false);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const body = await res.json();
        setEmailFailed(body.emailOk === false);
        setStep("code");
      } else if (res.status === 401) {
        setError("Invalid email or password.");
      } else {
        setError(`Server error (${res.status}) — check the function logs.`);
      }
    } catch {
      setError("Network error — is the site reachable?");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/staff/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    setBusy(false);
    if (res.ok) router.push("/staff");
    else setError("Invalid or expired code.");
  }

  return (
    <div className="max-w-sm mx-auto mt-12">
      <h1 className="text-2xl font-semibold mb-6">Staff sign-in</h1>
      {step === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4">
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
          <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full bg-gray-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
            Continue
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-4">
          {emailFailed ? (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
              The code email could not be sent (check email provider settings). The code is printed in the
              server function logs — Netlify → Logs → Functions.
            </p>
          ) : (
            <p className="text-sm text-gray-500">We emailed a 6-digit code to {email}.</p>
          )}
          <input inputMode="numeric" pattern="\d{6}" maxLength={6} required placeholder="000000" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-center text-xl tracking-[0.5em]" />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6}
            className="w-full bg-gray-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-gray-700 disabled:opacity-50">
            Sign in
          </button>
        </form>
      )}
    </div>
  );
}
