/**
 * Read-only video job diagnostics for ops / debugging.
 *
 * Usage (local Postgres):
 *   npx tsx scripts/inspect-video-job.ts <jobId>
 *
 * Usage (production Neon — unset LOCAL so DATABASE_URL wins):
 *   LOCAL_DATABASE_URL= npx tsx scripts/inspect-video-job.ts <jobId>
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config();

import { loadVideoJobInspectReport } from "@/lib/video/video-job-inspect.server";

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: npx tsx scripts/inspect-video-job.ts <jobId>");
  process.exit(1);
}

async function main() {
  const report = await loadVideoJobInspectReport(jobId);
  if (!report) {
    console.log("JOB_NOT_FOUND");
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
