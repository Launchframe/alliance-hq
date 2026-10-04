import { z } from "zod";

const id = z.string().min(1).max(100);
const expectedVersion = z.number().int().nonnegative();
export const supportCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("createTeam"), teamId: id, leadId: id, expectedVersion }).strict(),
  z.object({ kind: z.literal("replaceLead"), teamId: id, leadId: id, expectedVersion }).strict(),
  z.object({ kind: z.literal("rename"), teamId: id, name: z.string().max(1000), expectedVersion }).strict(),
  z.object({ kind: z.literal("move"), memberId: id, from: id.nullable(), to: id.nullable(), expectedVersion }).strict(),
  z.object({ kind: z.literal("swap"), memberId: id, otherMemberId: id, from: id, to: id, expectedVersion }).strict(),
]);
export const commandRequestSchema = z.object({ command: supportCommandSchema, idempotencyKey: z.string().min(8).max(100) }).strict();
export const undoRequestSchema = z.object({ actionIds: z.array(id).min(1).max(1000), expectedVersions: z.record(z.string().max(400), expectedVersion), idempotencyKey: z.string().min(8).max(100) }).strict();
