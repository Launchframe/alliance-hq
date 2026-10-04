import { z } from "zod";

export const ACTIVITY_SCHEMA_VERSION = 1;

export const ACTIVITY_CHANNELS = [
  "web",
  "discord",
  "integration",
  "automation",
] as const;
export type ActivityChannel = (typeof ACTIVITY_CHANNELS)[number];

export const ACTIVITY_METHODS = [
  "manual",
  "screenshot",
  "video",
  "import",
  "sync",
  "wheel",
] as const;
export type ActivityMethod = (typeof ACTIVITY_METHODS)[number];

export const ACTIVITY_RANKS = ["R1", "R2", "R3", "R4", "R5"] as const;
export type ActivityRank = (typeof ACTIVITY_RANKS)[number];

export const ACTIVITY_ROLES = [
  "owner",
  "maintainer",
  "officer",
  "data_entry",
  "member",
  "viewer",
] as const;
export type ActivityRole = (typeof ACTIVITY_ROLES)[number];

export const ACTIVITY_KINDS = ["change", "usage"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_VISIBILITIES = [
  "alliance",
  "private",
  "platform",
] as const;
export type ActivityVisibility = (typeof ACTIVITY_VISIBILITIES)[number];

export const ACTIVITY_ACTOR_KINDS = [
  "hq",
  "discord",
  "automation",
  "unknown",
] as const;
export type ActivityActorKind = (typeof ACTIVITY_ACTOR_KINDS)[number];

export const ACTIVITY_SEVERITIES = [
  "routine",
  "update",
  "override",
] as const;
export type ActivitySeverity = (typeof ACTIVITY_SEVERITIES)[number];

export const ACTIVITY_TOOLS = [
  "thp",
  "vr",
  "kills",
  "trains",
  "members",
  "vsPerformance",
  "banks",
  "battlePlan",
  "timeOff",
  "professions",
  "supportTeams",
  "plunderPlan",
  "notes",
] as const;
export type ActivityTool = (typeof ACTIVITY_TOOLS)[number];

export const ACTIVITY_RESOURCE_KEYS = [
  "vsScores",
  "donationScores",
  "scoreBatch",
  "scoreDate",
  "videoUpload",
  "screenshotReview",
  "roster",
  "rosterImport",
  "memberProfile",
  "commanderLink",
  "invitation",
  "joinCode",
  "hqAccess",
  "trainSchedule",
  "conductor",
  "vip",
  "conductorPool",
  "trainRuleTemplate",
  "trainBoarding",
  "battlePlanEvent",
  "bank",
  "bankDrop",
  "depositSlip",
  "depositProjection",
  "cityListImport",
  "timeOffEntry",
  "coverageDecision",
  "profession",
  "professionAssignment",
  "professionPairingImport",
  "supportTeam",
  "teamDraft",
  "teamProposal",
  "teamAssignments",
  "teamAction",
  "workItem",
  "plunderPlan",
  "plunderPlanOccurrence",
  "timeSuggestion",
  "note",
  "task",
  "board",
  "draft",
  "historyImport",
  "publication",
  "knowledgeSettings",
  "generationRequest",
  "sharingSettings",
  "accountSettings",
  "allianceSettings",
  "notificationSettings",
  "calendarConnection",
  "calendarSettings",
  "signInMethod",
  "password",
  "passkey",
  "deviceLink",
  "ashedConnection",
  "credentialSharing",
  "discordChannel",
  "feedbackReport",
  "reminder",
  "event",
  "commendation",
  "violation",
  "storeLink",
  "supportRequest",
  "vsWeekPlan",
  "vsMatchResult",
  "vsOpponent",
  "vsComplianceDecision",
  "vsMembershipMinimums",
  "sync",
  "report",
  "chart",
  "export",
  "parsingConfiguration",
  "experiment",
  "ocrDataset",
  "ocrModel",
  "ocrJob",
  "ocrMediaImport",
  "ocrPolicy",
  "ocrRetentionAction",
  "gameServer",
  "gameSeason",
] as const;
export type ActivityResourceKey = (typeof ACTIVITY_RESOURCE_KEYS)[number];

const ACTIVITY_IDENTIFIER_PATTERN = /^[^\s@]{1,200}$/;

export const activityIdentifierSchema = z
  .string()
  .regex(ACTIVITY_IDENTIFIER_PATTERN);

export const activityActorSchema = z
  .object({
    kind: z.enum(ACTIVITY_ACTOR_KINDS),
    hqUserId: activityIdentifierSchema.nullable(),
    discordUserId: activityIdentifierSchema.nullable(),
    personalOwnerHqUserId: activityIdentifierSchema.nullable(),
    commanderId: activityIdentifierSchema.nullable(),
    displayName: z.string().max(160).nullable(),
    hqRole: z.enum(ACTIVITY_ROLES).nullable(),
    gameRank: z.enum(ACTIVITY_RANKS).nullable(),
  })
  .strict()
  .superRefine((actor, ctx) => {
    if (
      actor.kind === "hq" &&
      (!actor.hqUserId || actor.personalOwnerHqUserId !== actor.hqUserId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["hqUserId"],
        message: "hq actors require matching hqUserId and personalOwnerHqUserId",
      });
    }
    if (actor.hqUserId === null && actor.hqRole !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["hqRole"],
        message: "hq role requires hq identity",
      });
    }
    if (actor.kind === "discord" && !actor.discordUserId) {
      ctx.addIssue({
        code: "custom",
        path: ["discordUserId"],
        message: "discord actors require discordUserId",
      });
    }
    if (
      actor.kind === "discord" &&
      actor.personalOwnerHqUserId !== actor.hqUserId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["personalOwnerHqUserId"],
        message: "discord owner must match verified hq identity",
      });
    }
    if (
      (actor.kind === "automation" || actor.kind === "unknown") &&
      [
        actor.hqUserId,
        actor.discordUserId,
        actor.personalOwnerHqUserId,
        actor.commanderId,
        actor.hqRole,
        actor.gameRank,
      ].some((value) => value !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message: "unattributed actors cannot carry identity or rank",
      });
    }
  });
export type ActivityActor = z.infer<typeof activityActorSchema>;

export const activityScopeSchema = z
  .object({
    allianceId: activityIdentifierSchema.nullable(),
    serverNumber: z
      .string()
      .regex(/^\d{1,8}$/)
      .nullable(),
    allianceTag: z.string().min(1).max(32).nullable(),
    allianceName: z.string().min(1).max(160).nullable(),
  })
  .strict();
export type ActivityScope = z.infer<typeof activityScopeSchema>;

export const activitySourceSchema = z
  .object({
    namespace: z.string().min(1).max(100),
    key: z.string().min(1).max(200),
  })
  .strict();
export type ActivitySource = z.infer<typeof activitySourceSchema>;
