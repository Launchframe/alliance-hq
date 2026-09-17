import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { generationAcceptSchema } from "@/lib/notes/generation.shared";
import { getGeneration, saveGenerationReview } from "@/lib/notes/generation.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return knowledgeApi(async (actor) => {
    const input = generationAcceptSchema.safeParse(await readKnowledgeJson(request, 1_000_000));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    const { id } = await params;
    await saveGenerationReview(actor, id, input.data);
    return getGeneration(actor, id);
  });
}
