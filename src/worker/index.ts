/**
 * Local background worker — polls the DB queue and processes jobs.
 * Run with: npm run worker
 * (On Netlify this loop is replaced by netlify/functions/process-jobs-background.)
 */

import { drainQueue } from "./drain";

const POLL_MS = 2000;

async function main() {
  console.log("[worker] started, polling every", POLL_MS, "ms");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const processed = await drainQueue(60 * 60 * 1000).catch((e) => {
      console.error("[worker] drain error:", e);
      return 0;
    });
    if (processed === 0) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
