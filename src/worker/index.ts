/**
 * Background worker — polls the DB queue and processes jobs.
 * Run with: npm run worker
 */

import { claimNext, complete, fail } from "@/services/queue";
import { processStatementJob } from "@/services/pipeline";
import { generateWorkbookJob } from "@/services/workbook/generate";

const POLL_MS = 2000;

async function tick() {
  const job = await claimNext();
  if (!job) return false;
  console.log(`[worker] job ${job.id} (${job.type}) attempt ${job.attempts}`);
  try {
    const payload = JSON.parse(job.payloadJson);
    switch (job.type) {
      case "process_statement":
        await processStatementJob(job.id, payload);
        break;
      case "generate_workbook":
        await generateWorkbookJob(job.id, payload);
        break;
      default:
        throw new Error(`unknown job type: ${job.type}`);
    }
    await complete(job.id);
    console.log(`[worker] job ${job.id} completed`);
  } catch (e) {
    console.error(`[worker] job ${job.id} failed:`, e);
    await fail(job.id, e instanceof Error ? e.stack ?? e.message : String(e));
  }
  return true;
}

async function main() {
  console.log("[worker] started, polling every", POLL_MS, "ms");
  // simple loop: drain queue, then sleep
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const hadWork = await tick().catch((e) => {
      console.error("[worker] tick error:", e);
      return false;
    });
    if (!hadWork) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
