/**
 * Auth core (Phase 2).
 * - Clients: passwordless magic links (15-min, single-use).
 * - Staff/admin: password (scrypt) + 6-digit email code (10-min, 5 attempts).
 * - Sessions: httpOnly cookie, sha256-hashed server side,
 *   12h absolute timeout + 60min idle timeout (spec: session timeout).
 * Raw tokens are NEVER stored — only sha256 hashes.
 */

import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";

export const SESSION_COOKIE = "altemore_session";
const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const SESSION_IDLE_MS = 60 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const STAFF_CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

export const sha256hex = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

// ---------- passwords (scrypt, no external deps) ----------

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---------- one-time tokens ----------

export async function createMagicLink(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.loginToken.create({
    data: {
      userId,
      purpose: "MAGIC_LINK",
      tokenHash: sha256hex(raw),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });
  return raw;
}

export async function createStaffCode(userId: string): Promise<string> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  // invalidate previous outstanding codes
  await db.loginToken.updateMany({
    where: { userId, purpose: "STAFF_2FA", usedAt: null },
    data: { usedAt: new Date() },
  });
  await db.loginToken.create({
    data: {
      userId,
      purpose: "STAFF_2FA",
      tokenHash: sha256hex(`${userId}:${code}`), // scoped so codes aren't cross-user guessable
      expiresAt: new Date(Date.now() + STAFF_CODE_TTL_MS),
    },
  });
  return code;
}

export async function consumeMagicLink(raw: string): Promise<User | null> {
  const token = await db.loginToken.findUnique({
    where: { tokenHash: sha256hex(raw) },
    include: { user: true },
  });
  if (!token || token.purpose !== "MAGIC_LINK" || token.usedAt || token.expiresAt < new Date()) return null;
  await db.loginToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });
  return token.user;
}

export async function consumeStaffCode(userId: string, code: string): Promise<boolean> {
  const token = await db.loginToken.findFirst({
    where: { userId, purpose: "STAFF_2FA", usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!token || token.expiresAt < new Date()) return false;
  if (token.attempts >= MAX_CODE_ATTEMPTS) return false;
  const ok = token.tokenHash === sha256hex(`${userId}:${code}`);
  await db.loginToken.update({
    where: { id: token.id },
    data: ok ? { usedAt: new Date() } : { attempts: { increment: 1 } },
  });
  return ok;
}

// ---------- sessions ----------

export async function createSession(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256hex(raw),
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
    },
  });
  return raw;
}

export async function setSessionCookie(raw: string) {
  (await cookies()).set(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
}

export async function getSessionUser(): Promise<User | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256hex(raw) },
    include: { user: true },
  });
  if (!session) return null;
  const now = new Date();
  if (session.expiresAt < now || now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // sliding idle window (throttled to once a minute to avoid write amplification)
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
  }
  return session.user;
}

export async function destroySession() {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) await db.session.deleteMany({ where: { tokenHash: sha256hex(raw) } });
  store.delete(SESSION_COOKIE);
}

// ---------- guards ----------

export async function requireStaff(): Promise<User> {
  const user = await getSessionUser();
  if (!user || (user.role !== "STAFF" && user.role !== "ADMIN")) throw new AuthError("staff");
  return user;
}

export async function requireClient(): Promise<User & { clientId: string }> {
  const user = await getSessionUser();
  if (!user || user.role !== "CLIENT" || !user.clientId) throw new AuthError("client");
  return user as User & { clientId: string };
}

export class AuthError extends Error {
  constructor(public scope: "staff" | "client") {
    super(`unauthorized:${scope}`);
  }
}
