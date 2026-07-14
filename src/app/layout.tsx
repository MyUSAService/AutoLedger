import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Altemore — Statement Portal (Staff)",
  description: "Internal staff review portal — Phase 1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="bg-gray-900 text-white px-6 py-3 flex items-center justify-between">
          <a href="/staff" className="font-semibold tracking-tight">
            Altemore <span className="text-gray-400 font-normal">· Statement Portal</span>
          </a>
          <span className="text-xs text-gray-400">Phase 1 — staff internal</span>
        </header>
        <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
