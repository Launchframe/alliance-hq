import { knowledgeApi } from "@/lib/notes/knowledge-api.server";
import { getGenerationThread } from "@/lib/notes/generation.server";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return knowledgeApi(async (actor) => getGenerationThread(actor, (await params).id));
}
