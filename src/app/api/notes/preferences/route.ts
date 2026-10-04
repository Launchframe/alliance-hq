import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { readWorkspacePreferences, saveWorkspacePreferences } from "@/lib/notes/preferences.server";

export const dynamic = "force-dynamic";
export const GET = () => knowledgeApi(readWorkspacePreferences);
export const PUT = (request: Request) => knowledgeApi(async (actor) => saveWorkspacePreferences(actor, await readKnowledgeJson(request, 8_000)));
