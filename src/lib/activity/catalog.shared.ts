import { z } from "zod";

import {
  ACTIVITY_CHANNELS,
  ACTIVITY_METHODS,
  ACTIVITY_RANKS,
  ACTIVITY_ROLES,
  ACTIVITY_SEVERITIES,
  ACTIVITY_TOOLS,
  activityActorSchema,
  activityIdentifierSchema,
  activityScopeSchema,
  activitySourceSchema,
  type ActivityKind,
  type ActivityResourceKey,
  type ActivityVisibility,
} from "./types.shared";

const statValueSchema = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);

const statSubmissionPayloadSchema = z
  .object({
    value: statValueSchema,
    previousValue: statValueSchema.nullable().optional(),
  })
  .strict();

const memberNameSchema = z.string().min(1).max(160);

const rankNumber = (rank: string) => Number(rank.slice(1));

const memberPromotedPayloadSchema = z
  .object({
    member: memberNameSchema,
    fromRank: z.enum(ACTIVITY_RANKS),
    toRank: z.enum(ACTIVITY_RANKS),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (rankNumber(payload.fromRank) >= rankNumber(payload.toRank)) {
      ctx.addIssue({
        code: "custom",
        path: ["toRank"],
        message: "promotion requires fromRank below toRank",
      });
    }
  });

const memberDemotedPayloadSchema = z
  .object({
    member: memberNameSchema,
    fromRank: z.enum(ACTIVITY_RANKS),
    toRank: z.enum(ACTIVITY_RANKS),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (rankNumber(payload.fromRank) <= rankNumber(payload.toRank)) {
      ctx.addIssue({
        code: "custom",
        path: ["toRank"],
        message: "demotion requires fromRank above toRank",
      });
    }
  });

const memberRankSetPayloadSchema = z
  .object({
    member: memberNameSchema,
    rank: z.enum(ACTIVITY_RANKS),
  })
  .strict();

const memberRankClearedPayloadSchema = z
  .object({
    member: memberNameSchema,
  })
  .strict();

const memberRoleChangedPayloadSchema = z
  .object({
    member: memberNameSchema,
    fromRole: z.enum(ACTIVITY_ROLES),
    toRole: z.enum(ACTIVITY_ROLES),
  })
  .strict();

const safeCountSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);

const scoresDiscardedPayloadSchema = z
  .object({
    affected: safeCountSchema,
    completed: safeCountSchema,
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.completed > payload.affected) {
      ctx.addIssue({
        code: "custom",
        path: ["completed"],
        message: "completed cannot exceed affected",
      });
    }
  });

const emptyPayloadSchema = z.object({}).strict();

const toolOpenedPayloadSchema = z
  .object({
    tool: z.enum(ACTIVITY_TOOLS),
  })
  .strict();

export type ActivityCatalogEntry = {
  feature: string;
  kind: ActivityKind;
  visibility: ActivityVisibility;
  descriptor: string;
  resource: ActivityResourceKey | null;
  payload: z.ZodType<unknown>;
};

export const activityCatalog = {
  "thp.submitted": {
    feature: "thp",
    kind: "change",
    visibility: "alliance",
    descriptor: "thpSubmitted",
    resource: null,
    payload: statSubmissionPayloadSchema,
  },
  "vr.submitted": {
    feature: "vr",
    kind: "change",
    visibility: "alliance",
    descriptor: "vrSubmitted",
    resource: null,
    payload: statSubmissionPayloadSchema,
  },
  "kills.submitted": {
    feature: "kills",
    kind: "change",
    visibility: "alliance",
    descriptor: "killsSubmitted",
    resource: null,
    payload: statSubmissionPayloadSchema,
  },
  "member.promoted": {
    feature: "members",
    kind: "change",
    visibility: "alliance",
    descriptor: "promoted",
    resource: null,
    payload: memberPromotedPayloadSchema,
  },
  "member.demoted": {
    feature: "members",
    kind: "change",
    visibility: "alliance",
    descriptor: "demoted",
    resource: null,
    payload: memberDemotedPayloadSchema,
  },
  "member.rank_set": {
    feature: "members",
    kind: "change",
    visibility: "alliance",
    descriptor: "rankSet",
    resource: null,
    payload: memberRankSetPayloadSchema,
  },
  "member.rank_cleared": {
    feature: "members",
    kind: "change",
    visibility: "alliance",
    descriptor: "rankCleared",
    resource: null,
    payload: memberRankClearedPayloadSchema,
  },
  "member.role_changed": {
    feature: "members",
    kind: "change",
    visibility: "alliance",
    descriptor: "roleChanged",
    resource: null,
    payload: memberRoleChangedPayloadSchema,
  },
  "member.weekly_pass_updated": {
    feature: "members",
    kind: "change",
    visibility: "alliance",
    descriptor: "updated",
    resource: "memberProfile",
    payload: emptyPayloadSchema,
  },
  "scores.discarded": {
    feature: "scores",
    kind: "change",
    visibility: "alliance",
    descriptor: "discarded",
    resource: "vsScores",
    payload: scoresDiscardedPayloadSchema,
  },
  "note.updated": {
    feature: "notes",
    kind: "change",
    visibility: "private",
    descriptor: "updated",
    resource: "note",
    payload: emptyPayloadSchema,
  },
  "account.email_changed": {
    feature: "account",
    kind: "change",
    visibility: "private",
    descriptor: "emailChanged",
    resource: null,
    payload: emptyPayloadSchema,
  },
  "account.merged": {
    feature: "account",
    kind: "change",
    visibility: "private",
    descriptor: "accountsMerged",
    resource: null,
    payload: emptyPayloadSchema,
  },
  "tool.opened": {
    feature: "usage",
    kind: "usage",
    visibility: "private",
    descriptor: "opened",
    resource: null,
    payload: toolOpenedPayloadSchema,
  },
} as const satisfies Record<string, ActivityCatalogEntry>;

export type ActivityEventKey = keyof typeof activityCatalog;

export function isActivityEventKey(value: unknown): value is ActivityEventKey {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(activityCatalog, value)
  );
}

const commonInputFields = {
  actor: activityActorSchema,
  scope: activityScopeSchema,
  channel: z.enum(ACTIVITY_CHANNELS).nullable(),
  method: z.enum(ACTIVITY_METHODS).nullable(),
  occurredAt: z.union([z.date(), z.iso.datetime({ precision: 6 })]),
  source: activitySourceSchema,
  resourceId: activityIdentifierSchema.nullish(),
  severity: z.enum(ACTIVITY_SEVERITIES),
  historical: z.boolean().default(false),
  historicalCurrentLabels: z.boolean().default(false),
};

const eventInput = <Key extends ActivityEventKey>(
  eventKey: Key,
  payload: (typeof activityCatalog)[Key]["payload"],
) =>
  z
    .object({
      eventKey: z.literal(eventKey),
      ...commonInputFields,
      payload,
    })
    .strict();

export const activityEventInputSchema = z
  .discriminatedUnion("eventKey", [
    eventInput("thp.submitted", statSubmissionPayloadSchema),
    eventInput("vr.submitted", statSubmissionPayloadSchema),
    eventInput("kills.submitted", statSubmissionPayloadSchema),
    eventInput("member.promoted", memberPromotedPayloadSchema),
    eventInput("member.demoted", memberDemotedPayloadSchema),
    eventInput("member.rank_set", memberRankSetPayloadSchema),
    eventInput("member.rank_cleared", memberRankClearedPayloadSchema),
    eventInput("member.role_changed", memberRoleChangedPayloadSchema),
    eventInput("member.weekly_pass_updated", emptyPayloadSchema),
    eventInput("scores.discarded", scoresDiscardedPayloadSchema),
    eventInput("note.updated", emptyPayloadSchema),
    eventInput("account.email_changed", emptyPayloadSchema),
    eventInput("account.merged", emptyPayloadSchema),
    eventInput("tool.opened", toolOpenedPayloadSchema),
  ])
  .superRefine((event, ctx) => {
    const entry = activityCatalog[event.eventKey];

    if (event.actor.kind === "unknown" && !event.historical) {
      ctx.addIssue({
        code: "custom",
        path: ["actor", "kind"],
        message: "unknown actors require historical events",
      });
    }
    if (
      event.channel === null &&
      !event.historical &&
      event.actor.kind !== "automation"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["channel"],
        message: "unknown channel requires historical or automation context",
      });
    }
    if (event.historicalCurrentLabels && !event.historical) {
      ctx.addIssue({
        code: "custom",
        path: ["historicalCurrentLabels"],
        message: "historicalCurrentLabels requires a historical event",
      });
    }
    if (entry.visibility === "alliance" && !event.scope.allianceId) {
      ctx.addIssue({
        code: "custom",
        path: ["scope", "allianceId"],
        message: "alliance events require scope.allianceId",
      });
    }
    if (entry.visibility === "private" && event.resourceId != null) {
      ctx.addIssue({
        code: "custom",
        path: ["resourceId"],
        message: "private events cannot carry a resourceId",
      });
    }
  });

export type ActivityEventInput = z.input<typeof activityEventInputSchema>;
export type ParsedActivityEvent = z.output<typeof activityEventInputSchema>;
export type ActivityPayload = ParsedActivityEvent["payload"];

export function parseActivityEvent(
  input: unknown,
): ReturnType<typeof activityEventInputSchema.safeParse> {
  return activityEventInputSchema.safeParse(input);
}
