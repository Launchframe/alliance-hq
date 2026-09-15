import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { getKnowledgeStatus, changeKnowledge } from "@/lib/notes/knowledge.server";
import { knowledgeCommandSchema } from "@/lib/notes/knowledge.shared";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) { return knowledgeApi(async (actor) => getKnowledgeStatus(actor, (await params).id)); }
export async function POST(request: Request, { params }: Context) {
  return knowledgeApi(async (actor) => {
    const input = knowledgeCommandSchema.safeParse(await readKnowledgeJson(request));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    const { id } = await params;
    await changeKnowledge(actor, id, input.data);
    return getKnowledgeStatus(actor, id);
  });
}
