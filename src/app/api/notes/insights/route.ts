import { knowledgeApi } from "@/lib/notes/knowledge-api.server";
import { listGeneratedInsights } from "@/lib/notes/generation.server";

export const dynamic = "force-dynamic";
export async function GET() { return knowledgeApi(async (actor) => ({ notes: await listGeneratedInsights(actor) })); }
