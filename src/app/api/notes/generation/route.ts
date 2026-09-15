import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { generationRequestSchema } from "@/lib/notes/generation.shared";
import { listGenerations, startGeneration } from "@/lib/notes/generation.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() { return knowledgeApi(listGenerations); }
export async function POST(request: Request) {
  return knowledgeApi(async (actor) => {
    const parsed = generationRequestSchema.safeParse(await readKnowledgeJson(request, 32_768));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    return startGeneration(actor, parsed.data);
  });
}
