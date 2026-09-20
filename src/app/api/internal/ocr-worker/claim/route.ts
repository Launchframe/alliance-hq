import { NextResponse } from "next/server";
import { readOcrJson } from "@/lib/ocr/learning/api.server";
import { withOcrWorker } from "@/lib/ocr/learning/control-api.server";
import { claimWorkerJob } from "@/lib/ocr/learning/control-leases.server";

export async function POST(request: Request) {
  return withOcrWorker(request, async () => {
    const body = await readOcrJson(request);
    return NextResponse.json({ job: await claimWorkerJob(body.workerCodeHash as string, body.jobId as string | undefined) });
  });
}
