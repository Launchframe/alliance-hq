import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { knowledgeQuerySchema } from "@/lib/notes/knowledge.shared";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";
import { retrieveKnowledgeEvidence } from "@/lib/officer-intel/retrieve-corpus.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return knowledgeApi(async (actor) => {
    const input = knowledgeQuerySchema.safeParse(await readKnowledgeJson(request));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    return { evidence: await retrieveKnowledgeEvidence(actor, input.data) };
  });
}
