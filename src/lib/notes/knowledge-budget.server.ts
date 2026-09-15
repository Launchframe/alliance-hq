import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { schema } from "@/lib/db";
import type { KnowledgeTransaction } from "./resources.server";

export async function reserveKnowledgeUsage(tx: KnowledgeTransaction, allianceId: string, principalKey: string, operation: "index" | "query" | "generate", inputChars: number) {
  if (!Number.isInteger(inputChars) || inputChars <= 0 || inputChars > 16_000) throw new Error("too_large");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge-budget:alliance:${allianceId}`}, 0))`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge-budget:principal:${principalKey}`}, 0))`);
  const usage = schema.knowledgeAiUsage;
  const since = new Date(Date.now() - 86_400_000);
  const [alliance] = await tx.select({ chars: sql<number>`coalesce(sum(input_chars), 0)` }).from(usage).where(and(eq(usage.allianceId, allianceId), gte(usage.createdAt, since)));
  const [principal] = await tx.select({ chars: sql<number>`coalesce(sum(input_chars), 0)`, recent: sql<number>`count(*) filter(where created_at > now() - interval '1 minute')` }).from(usage).where(and(eq(usage.principalKey, principalKey), gte(usage.createdAt, since)));
  if (Number(alliance.chars) + inputChars > 10_000_000 || Number(principal.chars) + inputChars > 2_000_000 || Number(principal.recent) >= 30) throw new Error("rate_limited");
  await tx.insert(usage).values({ id: nanoid(), allianceId, principalKey, operation, inputChars });
}
