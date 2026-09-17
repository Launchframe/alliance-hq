import { historyApi } from "@/lib/notes/import-api.server";
import { getHistoryImport } from "@/lib/notes/imports.server";
import { processHistoryStep } from "@/lib/notes/import-worker.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = (_request: Request, { params }: { params: Promise<{ id: string }> }) => historyApi("notes:create", async (actor) => {
  const { id } = await params;
  await getHistoryImport(actor, id);
  const result = await processHistoryStep(id);
  await getHistoryImport(actor, id);
  return result;
});
