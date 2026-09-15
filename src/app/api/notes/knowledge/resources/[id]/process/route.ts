import { knowledgeApi } from "@/lib/notes/knowledge-api.server";
import { getKnowledgeResource } from "@/lib/notes/knowledge-access.server";
import { processKnowledgeIndex } from "@/lib/notes/knowledge-index.server";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(_request: Request, { params }: Context) {
  return knowledgeApi(async (actor) => {
    const resource = await getKnowledgeResource(actor, (await params).id, true);
    return processKnowledgeIndex(resource.id, actor.sessionId);
  });
}
