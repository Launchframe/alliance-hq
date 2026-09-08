import { z } from "zod";

const statusKeys = {
  local: "sync.localOnly",
  pending: "sync.pending",
  synced: "sync.synced",
  failed: "sync.failed",
  cancel_pending: "sync.cancelPending",
  credentials_required: "sync.credentialsRequired",
  conflict: "sync.conflict",
  uncertain: "sync.uncertain",
} as const;

export type TimeOffSyncStatus = keyof typeof statusKeys;

export function timeOffSyncStatusKey(status: string) {
  return Object.hasOwn(statusKeys, status)
    ? statusKeys[status as TimeOffSyncStatus]
    : "sync.actionFailed";
}

export function timeOffSyncErrorKey(data: unknown, status?: number) {
  const code = data && typeof data === "object" && "code" in data ? data.code : null;
  if (status === 403 || code === "forbidden") return "workflow.errors.forbidden";
  if (code === "officerOnly") return "workflow.errors.officerOnly";
  if (code === "staleEntry") return "workflow.errors.staleEntry";
  if (code === "entryUnavailable") return "workflow.errors.entryUnavailable";
  if (code === "credentials_required" || code === "ashed_not_connected") return "sync.credentialsRequired";
  return "sync.actionFailed";
}

const periodSchema = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  recordType: z.enum(["vs", "donation"]),
});

export const timeOffSyncReviewSchema = z.object({
  version: z.number().int().nonnegative(),
  bindings: z.array(z.object({
    id: z.string().min(1),
    recordType: z.enum(["vs", "donation"]),
    status: z.string(),
    fingerprint: z.string().nullable(),
    remote: periodSchema.nullable(),
    candidates: z.array(periodSchema.extend({
      id: z.string().min(1),
      fingerprint: z.string().min(1),
      createdAt: z.iso.datetime({ offset: true }).nullable().optional(),
    })),
  })),
});

export type TimeOffSyncReview = z.infer<typeof timeOffSyncReviewSchema>;
export type TimeOffSyncBinding = TimeOffSyncReview["bindings"][number];
