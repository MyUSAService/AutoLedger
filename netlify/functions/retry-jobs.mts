/**
 * Scheduled function (every 15 min, see netlify.toml): if pending jobs exist
 * (e.g. a background invocation was missed or a retry is due), re-trigger the
 * background processor. Lightweight — never processes jobs itself.
 */
import { db } from "../../src/lib/db";

export default async () => {
  const pending = await db.job.count({
    where: { status: "PENDING", runAfter: { lte: new Date() } },
  });
  if (pending > 0 && process.env.URL) {
    console.log(`[retry-jobs] ${pending} pending job(s) — triggering background processor`);
    await fetch(`${process.env.URL}/.netlify/functions/process-jobs-background`, { method: "POST" }).catch((e) =>
      console.error("[retry-jobs] trigger failed:", e)
    );
  }
  return new Response(JSON.stringify({ pending }), { status: 200 });
};
