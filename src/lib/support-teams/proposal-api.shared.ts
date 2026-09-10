import { z } from "zod";

const id = z.string().min(1).max(200);
const version = z.number().int().nonnegative();
const base = z.object({ expectedVersion: version, idempotencyKey: z.string().uuid() });
export const createProposalSchema = base.strict();
export const proposalActionSchema = z.discriminatedUnion("action", [
  base.extend({ action: z.literal("move"), memberId: id, from: id.nullable(), to: id.nullable() }).strict(),
  base.extend({ action: z.literal("swap"), memberId: id, otherMemberId: id, from: id, to: id }).strict(),
  base.extend({ action: z.literal("submit") }).strict(),
  base.extend({ action: z.literal("approve") }).strict(),
  base.extend({ action: z.literal("cancel") }).strict(),
  base.extend({ action: z.literal("publish"), expectedPublishedVersion: version, override: z.boolean() }).strict(),
]);
