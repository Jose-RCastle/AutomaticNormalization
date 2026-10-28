/// <reference lib="webworker" />
import { executeJob, Job } from '../../lib/jobs';
addEventListener('message', async ({ data }: { data: Job }) => {
  try {
    postMessage({ ok: true, result: await executeJob(data) });
  } catch (error) {
    postMessage({ ok: false, error: (error as Error).message });
  }
});
