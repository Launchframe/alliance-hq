import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { publicationCommandSchema } from "@/lib/notes/publications.shared";
import { getPublication, changePublication } from "@/lib/notes/publications.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) { return knowledgeApi(async (actor) => getPublication(actor, (await params).id)); }
export async function POST(request: Request, { params }: Context) {
  return knowledgeApi(async (actor) => {
    const input = publicationCommandSchema.safeParse(await readKnowledgeJson(request));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    return changePublication(actor, (await params).id, input.data);
  });
}
