/**
 * Queue drain loop shared by the local polling worker and the Netlify
 * background function. Processes jobs until the queue is empty or the
 * time budget is exhausted.
 */
import { claimNext, complete, fail } from "@/services/queue";
import { processStatementJob } from "@/services/pipeline";
import { generateWorkbookJob } from "@/services/workbook/generate";

export async function drainQueue(budgetMs: number): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadline) {
    const job = await claimNext();
    if (!job) break;
    console.log(`[drain] job ${job.id} (${job.type}) attempt ${job.attempts}`);
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
      processed++;
    } catch (e) {
      console.error(`[drain] job ${job.id} failed:`, e);
      await fail(job.id, e instanceof Error ? e.stack ?? e.message : String(e));
    }
  }
  return processed;
}
