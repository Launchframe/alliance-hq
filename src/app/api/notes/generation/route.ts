import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { generationRequestSchema } from "@/lib/notes/generation.shared";
import { listGenerations, listGenerationPage, startGeneration } from "@/lib/notes/generation.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  return knowledgeApi((actor) => {
    const query = new URL(request.url).searchParams;
    if (!query.has("format")) return listGenerations(actor);
    if (query.get("format") !== "page") throw new KnowledgeAccessError("invalid");
    return listGenerationPage(actor, query.get("cursor"));
  });
}
export async function POST(request: Request) {
  return knowledgeApi(async (actor) => {
    const parsed = generationRequestSchema.safeParse(await readKnowledgeJson(request, 32_768));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    return startGeneration(actor, parsed.data);
  });
}
