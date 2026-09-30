import { historyApi } from "@/lib/notes/import-api.server";
import { getOwnedHistoryImport } from "@/lib/notes/imports.server";
import { processHistoryStep } from "@/lib/notes/import-worker.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = (_request: Request, { params }: { params: Promise<{ id: string }> }) => historyApi("notes:create", async (actor) => {
  const { id } = await params;
  await getOwnedHistoryImport(actor, id);
  const result = await processHistoryStep(id);
  await getOwnedHistoryImport(actor, id);
  return result;
});
