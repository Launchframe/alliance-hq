import { historyApi, historyJson } from "@/lib/notes/import-api.server";
import { historyInitSchema } from "@/lib/notes/imports.shared";
import { initializeHistoryImport, listHistoryImports } from "@/lib/notes/imports.server";

export const dynamic = "force-dynamic";
export const GET = () => historyApi("notes:read", async (actor) => ({ scope: `${actor.allianceId}:${actor.hqUserId}`, imports: await listHistoryImports(actor) }));
export const POST = (request: Request) => historyApi("notes:create", async (actor) => initializeHistoryImport(actor, historyInitSchema.parse(await historyJson(request))));
