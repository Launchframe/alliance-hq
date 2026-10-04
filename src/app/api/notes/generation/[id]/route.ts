import { z } from "zod";
import { knowledgeApi, readKnowledgeJson } from "@/lib/notes/knowledge-api.server";
import { getGeneration, controlGeneration, acceptGeneration } from "@/lib/notes/generation.server";
import { generationAcceptSchema } from "@/lib/notes/generation.shared";
import { KnowledgeAccessError } from "@/lib/notes/resources.server";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: Context) { return knowledgeApi(async (actor) => getGeneration(actor, (await params).id)); }
export async function PATCH(request: Request, { params }: Context) {
  return knowledgeApi(async (actor) => {
    const parsed = z.object({ command: z.enum(["cancel", "retry"]), expectedVersion: z.number().int().positive() }).safeParse(await readKnowledgeJson(request));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    const { id } = await params;
    await controlGeneration(actor, id, parsed.data.command, parsed.data.expectedVersion);
    return getGeneration(actor, id);
  });
}
export async function POST(request: Request, { params }: Context) {
  return knowledgeApi(async (actor) => {
    const parsed = generationAcceptSchema.safeParse(await readKnowledgeJson(request, 1_000_000));
    if (!parsed.success) throw new KnowledgeAccessError("invalid");
    return acceptGeneration(actor, (await params).id, parsed.data);
  });
}
