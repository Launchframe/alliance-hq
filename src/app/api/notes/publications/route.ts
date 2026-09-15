import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { publicationPreviewSchema } from "@/lib/notes/publications.shared";
import { listPublications, preparePublication } from "@/lib/notes/publications.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) { return knowledgeApi((actor) => listPublications(actor, new URL(request.url).searchParams.get("noteId") ?? "")); }
export async function POST(request: Request) {
  return knowledgeApi(async (actor) => {
    const input = publicationPreviewSchema.safeParse(await readKnowledgeJson(request, 1_000_000));
    if (!input.success) throw new KnowledgeAccessError("invalid");
    return preparePublication(actor, input.data);
  });
}
