import { knowledgeApi } from "@/lib/notes/knowledge-api.server";
import { getGeneration, processGeneration } from "@/lib/notes/generation.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return knowledgeApi(async (actor) => {
    const { id } = await params;
    await getGeneration(actor, id);
    return processGeneration(id);
  });
}
