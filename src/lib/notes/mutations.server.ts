import "server-only";

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { writeOfficerActionAudit } from "@/lib/bff/officer-action-audit.server";
import type { KnowledgeActor } from "./policy.shared";
import { KnowledgeAccessError, recheckKnowledgeActor, type KnowledgeTransaction } from "./resources.server";

export const knowledgeHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function knowledgePrincipalKey(actor: KnowledgeActor): string {
  if (actor.hqUserId) return `hq:${actor.hqUserId}`;
  if (actor.kind === "discord" && actor.discordUserId) return `discord:${actor.discordUserId}`;
  throw new KnowledgeAccessError("forbidden");
}
type ReceiptResult = typeof schema.knowledgeMutationReceipts.$inferSelect.result;

export async function withKnowledgeReceipt(actor: KnowledgeActor & { sessionId?: string }, action: string, requestId: string, payload: unknown, operation: (tx: KnowledgeTransaction, receiptId: string) => Promise<ReceiptResult>) {
  const principalKey = knowledgePrincipalKey(actor);
  const requestHash = knowledgeHash([action, payload]);
  const result = await getDb().transaction(async (tx) => {
    await recheckKnowledgeActor(tx, actor);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${knowledgeHash([actor.allianceId, principalKey, requestId])}, 0))`);
    const [prior] = await tx.select().from(schema.knowledgeMutationReceipts).where(and(
      eq(schema.knowledgeMutationReceipts.allianceId, actor.allianceId), eq(schema.knowledgeMutationReceipts.principalKey, principalKey), eq(schema.knowledgeMutationReceipts.requestId, requestId),
    ));
    if (prior) {
      if (prior.requestHash !== requestHash) throw new KnowledgeAccessError("changed");
      return { ...prior.result, replayed: true };
    }
    const id = nanoid();
    const value = await operation(tx, id);
    await tx.insert(schema.knowledgeMutationReceipts).values({ id, allianceId: actor.allianceId, principalKey, requestId, requestHash, result: value });
    return { ...value, replayed: false };
  });
  if (!result.replayed) await writeOfficerActionAudit({ sessionId: actor.sessionId, hqUserId: actor.hqUserId, allianceId: actor.allianceId, action, severity: action === "notes.task_update" ? "update" : "routine", permission: action === "notes.task_update" ? "notes:read" : "notes:create", resourceType: "notes_workspace" });
  return result;
}
