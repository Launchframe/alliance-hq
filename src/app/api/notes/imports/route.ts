import { historyApi, historyJson } from "@/lib/notes/import-api.server";
import { historyInitSchema, parseHistoryListCursor } from "@/lib/notes/imports.shared";
import { initializeHistoryImport, listHistoryImports } from "@/lib/notes/imports.server";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => historyApi("notes:read", async (actor) => listHistoryImports(actor, parseHistoryListCursor(new URL(request.url).searchParams.get("cursor"))));
export const POST = (request: Request) => historyApi("notes:create", async (actor) => initializeHistoryImport(actor, historyInitSchema.parse(await historyJson(request))));
