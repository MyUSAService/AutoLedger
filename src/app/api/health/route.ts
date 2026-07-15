import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Health check: verifies the runtime can reach the database.
 * Returns error CODE only (no connection details) — safe to expose.
 */
export async function GET() {
  const checks: Record<string, string> = {};
  try {
    const users = await db.user.count();
    checks.database = `ok (${users} users)`;
  } catch (e) {
    const err = e as { code?: string; name?: string; message?: string };
    checks.database = `FAIL: ${err.code ?? err.name ?? "unknown"} — ${String(err.message ?? "").slice(0, 120)}`;
  }
  checks.storageDriver = process.env.STORAGE_DRIVER ?? "unset";
  checks.hasAnthropicKey = process.env.ANTHROPIC_API_KEY ? "yes" : "NO";
  checks.hasResendKey = process.env.RESEND_API_KEY ? "yes" : "no";
  checks.hasDatabaseUrl = process.env.DATABASE_URL ? "yes" : "NO";
  return NextResponse.json(checks);
}
