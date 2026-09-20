import { knowledgeApi } from "@/lib/notes/knowledge-api.server";
import { listKnowledgeResources, listKnowledgeResourcePage } from "@/lib/notes/knowledge.server";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return knowledgeApi((actor) => {
    const params = new URL(request.url).searchParams;
    const offset = Number(params.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 5000) throw new KnowledgeAccessError("invalid");
    if (params.has("format")) {
      if (params.get("format") !== "page") throw new KnowledgeAccessError("invalid");
      return listKnowledgeResourcePage(actor, params.get("owned") === "true", params.get("cursor"), offset);
    }
    return listKnowledgeResources(actor, params.get("owned") === "true", offset);
  });
}
