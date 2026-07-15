"use client";

import { useRouter } from "next/navigation";

export function ClientTopBar({ locale, logoutLabel }: { locale: "it" | "en"; logoutLabel: string }) {
  const router = useRouter();

  async function switchLocale(l: "it" | "en") {
    await fetch("/api/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: l }),
    });
    router.refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex justify-end items-center gap-3 text-xs text-gray-400 mb-6">
      <button onClick={() => switchLocale("it")} className={locale === "it" ? "font-bold text-gray-700" : "hover:underline"}>IT</button>
      <button onClick={() => switchLocale("en")} className={locale === "en" ? "font-bold text-gray-700" : "hover:underline"}>EN</button>
      <span>·</span>
      <button onClick={logout} className="hover:underline">{logoutLabel}</button>
    </div>
  );
}
