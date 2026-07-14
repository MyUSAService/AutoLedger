/**
 * DB-backed job queue (§4). Hosting-agnostic — no Redis dependency.
 * Claim uses an atomic UPDATE ... WHERE status='PENDING' so multiple
 * workers never double-process. Swappable for BullMQ later if needed.
 */

import { db } from "@/lib/db";
import type { Job } from "@prisma/client";

export type JobType = "process_statement" | "generate_workbook";

export async function enqueue(type: JobType, payload: Record<string, unknown>): Promise<string> {
  const job = await db.job.create({
    data: { type, payloadJson: JSON.stringify(payload) },
  });
  return job.id;
}

/** Atomically claim the next pending job. Returns null if queue is empty. */
export async function claimNext(): Promise<Job | null> {
  // findFirst + conditional update loop: safe under concurrency because the
  // update only wins if status is still PENDING.
  for (let i = 0; i < 5; i++) {
    const candidate = await db.job.findFirst({
      where: { status: "PENDING", runAfter: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
    });
    if (!candidate) return null;
    const { count } = await db.job.updateMany({
      where: { id: candidate.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 1) return db.job.findUnique({ where: { id: candidate.id } });
  }
  return null;
}

export async function reportProgress(jobId: string, progress: number, label?: string) {
  await db.job.update({
    where: { id: jobId },
    data: { progress, progressLabel: label },
  });
}

export async function complete(jobId: string) {
  await db.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED", progress: 100, finishedAt: new Date() },
  });
}

export async function fail(jobId: string, error: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
  const retriable = job.attempts < job.maxAttempts;
  await db.job.update({
    where: { id: jobId },
    data: retriable
      ? { status: "PENDING", lastError: error, runAfter: new Date(Date.now() + 30_000) }
      : { status: "FAILED", lastError: error, finishedAt: new Date() },
  });
}
