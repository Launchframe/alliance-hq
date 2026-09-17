import { z } from "zod";
import { captureTaskSchema, redactIntakeText, semanticIntakeSchema } from "./intake.shared";
import type { KnowledgeEvidence } from "./knowledge.shared";

export const GENERATION_KINDS = ["synthesize", "localize", "ask", "insight"] as const;
export type GenerationKind = typeof GENERATION_KINDS[number];
export const generationRequestSchema = z.object({ requestId: z.string().min(8).max(120), kind: z.enum(GENERATION_KINDS), locale: z.enum(["en-US", "pt-BR"]), resourceIds: z.array(z.string().min(1).max(160)).max(3).default([]), question: z.string().trim().max(2_000).default(""), threadId: z.string().max(120).nullable().default(null), includeSources: z.boolean().default(false) });
export const generationPartSchema = z.object({ title: z.string().trim().min(1).max(160), sections: z.array(z.object({ text: z.string().trim().min(1).max(6_000), citations: z.array(z.object({ id: z.string().min(1).max(180), quote: z.string().min(1).max(1_000) })).min(1).max(6) })).min(1).max(12), actions: z.array(semanticIntakeSchema.shape.actions.element.extend({ evidenceId: z.string().min(1).max(180) })).max(6) });
export type GenerationPart = z.infer<typeof generationPartSchema>;
export const generationAcceptSchema = z.object({ requestId: z.string().min(8).max(120), expectedVersion: z.number().int().positive(), title: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(100_000), actions: z.array(captureTaskSchema).max(180).refine((actions) => actions.filter((action) => action.included).length <= 10) });
export type GenerationReview = Pick<z.infer<typeof generationAcceptSchema>, "title" | "body" | "actions">;
export type GenerationResult = { review: GenerationReview | null; id: string; kind: GenerationKind; state: "pending" | "running" | "ready" | "accepted" | "cancelled" | "failed" | "invalidated"; version: number; cursor: number; total: number; locale: string; errorCode: string | null; parts: GenerationPart[]; evidence: KnowledgeEvidence[]; noteId: string | null; threadId: string | null };
export function validateGenerationPart(value: unknown, sources: Array<{ id: string; text: string }>, kind: GenerationKind): value is GenerationPart {
  const parsed = generationPartSchema.safeParse(value);
  if (!parsed.success || redactIntakeText(JSON.stringify(value)) !== JSON.stringify(value)) return false;
  const byId = new Map(sources.map((source) => [source.id, source.text]));
  const cited = new Set<string>();
  for (const section of parsed.data.sections) for (const citation of section.citations) {
    if (!citation.quote.trim() || !byId.get(citation.id)?.includes(citation.quote)) return false;
    cited.add(citation.id);
  }
  return parsed.data.actions.every((action) => !!action.evidence.trim() && !!byId.get(action.evidenceId)?.includes(action.evidence)) && (kind !== "localize" || !parsed.data.actions.length && sources.every((source) => cited.has(source.id)));
}
export function generationBody(parts: GenerationPart[]): string {
  let citation = 0;
  return parts.flatMap((part) => part.sections.map((section) => `${section.text}\n\n${section.citations.map(() => `[${++citation}]`).join(" ")}`)).join("\n\n");
}
