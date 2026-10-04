import { z } from "zod";

const version = z.number().int().nonnegative();
const id = z.string().min(1).max(200);
const idempotencyKey = z.uuid();
export const scheduleDraftSchema = z.object({ expectedVersion: version, startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), roundMinutes: z.number().int().min(1).max(1440), idempotencyKey }).strict();
export const pickDraftSchema = z.object({ teamId: id, memberId: id, expectedRound: z.number().int().positive(), expectedRoundVersion: version, expectedSlotVersion: version, expectedMemberVersion: version, idempotencyKey }).strict();
export const extendDraftSchema = z.object({ endsAt: z.iso.datetime({ offset: true }), expectedVersion: version, idempotencyKey }).strict();
export const publishDraftSchema = z.object({ expectedVersion: version, allowUnsorted: z.boolean(), idempotencyKey }).strict();
export const cancelDraftSchema = z.object({ expectedVersion: version, idempotencyKey }).strict();
