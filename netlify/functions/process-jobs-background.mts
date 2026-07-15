/**
 * Netlify Background Function (15-min limit) — drains the job queue.
 * Invoked fire-and-forget after every enqueue (src/services/jobTrigger.ts)
 * and by the scheduled retry function.
 */
import { drainQueue } from "../../src/worker/drain";

export default async () => {
  const processed = await drainQueue(13 * 60 * 1000); // 13-min budget, 2-min safety margin
  console.log(`[background] processed ${processed} job(s)`);
  return new Response(JSON.stringify({ processed }), { status: 200 });
};
