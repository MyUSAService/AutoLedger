/**
 * Job processing trigger.
 * - Locally: the polling worker (npm run worker) picks jobs up — no trigger needed.
 * - On Netlify: there is no long-lived worker, so after enqueueing we fire the
 *   background function (15-min limit) which drains the queue. A scheduled
 *   function retries anything left over (see netlify/functions/).
 */
export async function triggerJobProcessing(): Promise<void> {
  const base = process.env.URL; // set by Netlify at runtime
  if (!process.env.NETLIFY || !base) return; // local dev → worker handles it
  try {
    // Background functions ack with 202 immediately; don't await processing.
    await fetch(`${base}/.netlify/functions/process-jobs-background`, { method: "POST" });
  } catch (e) {
    // Non-fatal: the scheduled function will pick the job up.
    console.error("[jobTrigger] failed to invoke background function:", e);
  }
}
