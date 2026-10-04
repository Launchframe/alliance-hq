import { knowledgeApi } from "@/lib/notes/knowledge-api.server";
import { generatedNoteEvidence } from "@/lib/notes/generation.server";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) { return knowledgeApi(async (actor) => generatedNoteEvidence(actor, (await params).id)); }
