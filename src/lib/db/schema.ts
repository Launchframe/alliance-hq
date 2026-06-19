import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const alliances = pgTable("alliances", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  /** In-game tag, e.g. LFgo */
  tag: text("tag"),
  name: text("name").notNull(),
  ashedAllianceId: text("ashed_alliance_id").unique(),
  ownerAshedUserId: text("owner_ashed_user_id"),
  ownerEmail: text("owner_email"),
  collaboratorsJson: jsonb("collaborators_json").$type<string[]>(),
  rolesSyncedAt: timestamp("roles_synced_at", { withTimezone: true }),
  /** Active game season key for VR tracking (e.g. "42"). */
  currentSeasonKey: text("current_season_key"),
  /** Last War state server number from Ashed Alliance.server_number (e.g. 1203). */
  gameServerNumber: integer("game_server_number"),
  /** Server open time (ms epoch) from cpt-hedge — used for age fallback. */
  gameServerOpenTimestamp: bigint("game_server_open_timestamp", {
    mode: "number",
  }),
  /** Owner manual season; when set, cron does not overwrite effective season. */
  seasonKeyOverride: text("season_key_override"),
  /** Last auto-synced season from cpt-hedge or age fallback. */
  seasonKeySynced: text("season_key_synced"),
  /** override | cpt-hedge | age-fallback | default */
  seasonKeySource: text("season_key_source"),
  seasonSyncedAt: timestamp("season_synced_at", { withTimezone: true }),
  seasonIsPostSeason: integer("season_is_post_season").notNull().default(0),
  seasonWeek: integer("season_week"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqUsers = pgTable("hq_users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  ashedUserId: text("ashed_user_id"),
  /** null = Server Time (UTC−02:00); otherwise an IANA zone id */
  timezone: text("timezone"),
  isPlatformMaintainer: integer("is_platform_maintainer").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id"),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: integer("is_system").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [unique("roles_alliance_name_unique").on(table.allianceId, table.name)],
);

export const permissions = pgTable("permissions", {
  id: text("id").primaryKey(),
  description: text("description"),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: text("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const allianceMemberships = pgTable(
  "alliance_memberships",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    hqUserId: text("hq_user_id")
      .notNull()
      .references(() => hqUsers.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    source: text("source").notNull().default("ashed"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("alliance_memberships_alliance_user_unique").on(
      table.allianceId,
      table.hqUserId,
    ),
  ],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userLabel: text("user_label"),
  allianceId: text("alliance_id"),
  /** In-game alliance tag, e.g. LFgo — resolves allianceId from global Alliance list */
  allianceTag: text("alliance_tag"),
  hqUserId: text("hq_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
  /** HQ tenant row — distinct from Ashed alliance id on allianceId */
  currentAllianceId: text("current_alliance_id").references(() => alliances.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const credentialPairingCodes = pgTable("credential_pairing_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  purpose: text("purpose").notNull(),
  sourceSessionId: text("source_session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  sourceHqUserId: text("source_hq_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
  allianceId: text("alliance_id").references(() => alliances.id, {
    onDelete: "set null",
  }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  consumedBySessionId: text("consumed_by_session_id").references(
    () => sessions.id,
    { onDelete: "set null" },
  ),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const linkedDevices = pgTable("linked_devices", {
  id: text("id").primaryKey(),
  hqUserId: text("hq_user_id")
    .notNull()
    .references(() => hqUsers.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  pairingCodeId: text("pairing_code_id").references(
    () => credentialPairingCodes.id,
    { onDelete: "set null" },
  ),
  deviceName: text("device_name").notNull(),
  userAgent: text("user_agent"),
  osLabel: text("os_label"),
  linkedAt: timestamp("linked_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastAccessAt: timestamp("last_access_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const ashedCredentials = pgTable("ashed_credentials", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  appId: text("app_id").notNull(),
  originUrl: text("origin_url").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  expiryReminderDays: integer("expiry_reminder_days").notNull().default(14),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const videoUploadGroups = pgTable("video_upload_groups", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  allianceId: text("alliance_id"),
  storageKey: text("storage_key"),
  fileName: text("file_name"),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  scoreTarget: text("score_target"),
  boardKey: text("board_key"),
  hqEventId: text("hq_event_id"),
  /** FK to video_jobs.id — not enforced by Drizzle to avoid circular dep */
  primaryJobId: text("primary_job_id"),
  selectedJobId: text("selected_job_id"),
  accuracyJobId: text("accuracy_job_id"),
  comparisonJson: jsonb("comparison_json"),
  /** Experiment platform: which campaign this group is assigned to */
  experimentCampaignId: text("experiment_campaign_id"),
  /** Experiment platform: which arm within the campaign */
  experimentArmId: text("experiment_arm_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const videoJobs = pgTable("video_jobs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  hqUserId: text("hq_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull(),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  /** @deprecated use scoreTarget */
  category: text("category"),
  scoreTarget: text("score_target"),
  storageKey: text("storage_key"),
  allianceId: text("alliance_id"),
  parseSessionId: text("parse_session_id"),
  /** Multi-board seasonal: kills | resources | points */
  boardKey: text("board_key"),
  /** Alliance Star commendation (when enabled) */
  commendationId: text("commendation_id"),
  /** HQ native event occurrence */
  hqEventId: text("hq_event_id"),
  ingestMethod: text("ingest_method").notNull().default("video"),
  frameCount: integer("frame_count"),
  uploadedFrameCount: integer("uploaded_frame_count"),
  errorMessage: text("error_message"),
  timingsJson: jsonb("timings_json").$type<Record<string, unknown>>(),
  totalFileSizeBytes: bigint("total_file_size_bytes", { mode: "number" }),
  rating: text("rating"),
  ratingAt: timestamp("rating_at", { withTimezone: true }),
  ratingReason: text("rating_reason"),
  qualityScore: real("quality_score"),
  qualityBucket: text("quality_bucket"),
  qualityComputedAt: timestamp("quality_computed_at", { withTimezone: true }),
  /** Phase 6: upload group linkage */
  groupId: text("group_id"),
  passKey: text("pass_key"),
  passIndex: integer("pass_index"),
  passRole: text("pass_role"),
  extractionConfigJson: jsonb("extraction_config_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const videoFrames = pgTable("video_frames", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => videoJobs.id, { onDelete: "cascade" }),
  frameIndex: integer("frame_index").notNull(),
  storageKey: text("storage_key").notNull(),
  ssimScore: doublePrecision("ssim_score"),
  uploadMs: integer("upload_ms"),
  extractMs: integer("extract_ms"),
  ocrEntryCount: integer("ocr_entry_count"),
  ocrError: text("ocr_error"),
  ocrRawJson: jsonb("ocr_raw_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const videoJobSurveys = pgTable(
  "video_job_surveys",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    rowCountEstimate: integer("row_count_estimate"),
    scrollStyle: text("scroll_style"),
    aboveAverageScroll: boolean("above_average_scroll"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [unique("video_job_surveys_job_id_unique").on(table.jobId)],
);

export const parseSessions = pgTable("parse_sessions", {
  id: text("id").primaryKey(),
  jobId: text("job_id")
    .notNull()
    .references(() => videoJobs.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  scoreTarget: text("score_target").notNull(),
  allianceId: text("alliance_id"),
  rowCount: integer("row_count").notNull().default(0),
  matchedCount: integer("matched_count").notNull().default(0),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const parsedRows = pgTable("parsed_rows", {
  id: text("id").primaryKey(),
  parseSessionId: text("parse_session_id")
    .notNull()
    .references(() => parseSessions.id, { onDelete: "cascade" }),
  ocrName: text("ocr_name").notNull(),
  score: text("score").notNull(),
  rank: integer("rank"),
  memberId: text("member_id"),
  memberName: text("member_name"),
  matchConfidence: doublePrecision("match_confidence"),
  matchMethod: text("match_method"),
  /** 1 when OCR produced multiple scores for the same sanitized name */
  scoreConflict: integer("score_conflict").notNull().default(0),
  frameIndex: integer("frame_index"),
  deleted: integer("deleted").notNull().default(0),
  edited: integer("edited").notNull().default(0),
  /** 1 when row was manually added by the user on the review page */
  manuallyAdded: integer("manually_added").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const scrollProfiles = pgTable("scroll_profiles", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  sampleIntervalMs: integer("sample_interval_ms").notNull().default(500),
  rowsPerFrame: integer("rows_per_frame"),
  jobCount: integer("job_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
  allianceId: text("alliance_id"),
  hqUserId: text("hq_user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceName: text("resource_name"),
  resourceId: text("resource_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqEventSeries = pgTable("hq_event_series", {
  id: text("id").primaryKey(),
  allianceId: text("alliance_id").notNull(),
  scoreTarget: text("score_target").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  scoreType: text("score_type"),
  ashedSeriesId: text("ashed_series_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqEvents = pgTable("hq_events", {
  id: text("id").primaryKey(),
  seriesId: text("series_id").references(() => hqEventSeries.id, {
    onDelete: "set null",
  }),
  allianceId: text("alliance_id").notNull(),
  scoreTarget: text("score_target").notNull(),
  name: text("name").notNull(),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("active"),
  ashedEventId: text("ashed_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqCommendations = pgTable("hq_commendations", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqEventBoards = pgTable("hq_event_boards", {
  id: text("id").primaryKey(),
  hqEventId: text("hq_event_id")
    .notNull()
    .references(() => hqEvents.id, { onDelete: "cascade" }),
  boardKey: text("board_key").notNull(),
  name: text("name"),
  scoreType: text("score_type"),
  commendationId: text("commendation_id").references(() => hqCommendations.id, {
    onDelete: "set null",
  }),
  ashedEventId: text("ashed_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqEventMembers = pgTable("hq_event_members", {
  id: text("id").primaryKey(),
  hqEventId: text("hq_event_id")
    .notNull()
    .references(() => hqEvents.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Maps a Discord user to an Ashed member within an alliance. */
export const discordMemberLinks = pgTable(
  "discord_member_links",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    discordUserId: text("discord_user_id").notNull(),
    discordUsername: text("discord_username"),
    ashedMemberId: text("ashed_member_id").notNull(),
    memberDisplayName: text("member_display_name"),
    gameUid: text("game_uid").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("discord_member_links_alliance_discord_member_unique").on(
      table.allianceId,
      table.discordUserId,
      table.ashedMemberId,
    ),
    unique("discord_member_links_alliance_member_unique").on(
      table.allianceId,
      table.ashedMemberId,
    ),
  ],
);

/** Highest self-reported base VR per member per game season. */
export const memberSeasonVr = pgTable(
  "member_season_vr",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    ashedMemberId: text("ashed_member_id").notNull(),
    seasonKey: text("season_key").notNull(),
    highestBaseVr: integer("highest_base_vr").notNull(),
    flaggedAt: timestamp("flagged_at", { withTimezone: true }),
    flagReason: text("flag_reason"),
    updatedByDiscordUserId: text("updated_by_discord_user_id"),
    updatedByHqUserId: text("updated_by_hq_user_id").references(() => hqUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("member_season_vr_alliance_member_season_unique").on(
      table.allianceId,
      table.ashedMemberId,
      table.seasonKey,
    ),
  ],
);

/** Short-lived Discord bot state (/link walkthrough, anomaly confirm, char picker). */
export const discordBotPending = pgTable("discord_bot_pending", {
  discordUserId: text("discord_user_id").primaryKey(),
  allianceId: text("alliance_id")
    .notNull()
    .references(() => alliances.id, { onDelete: "cascade" }),
  pendingJson: jsonb("pending_json").$type<Record<string, unknown>>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Maps a Discord server to an HQ alliance (multi-tenant bot). */
export const discordGuildAlliances = pgTable("discord_guild_alliances", {
  guildId: text("guild_id").primaryKey(),
  allianceId: text("alliance_id")
    .notNull()
    .references(() => alliances.id, { onDelete: "cascade" }),
  registeredAt: timestamp("registered_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Per-alliance Ashed connection for bot roster sync (encrypted token). */
export const allianceAshedCredentials = pgTable("alliance_ashed_credentials", {
  id: text("id").primaryKey(),
  allianceId: text("alliance_id")
    .notNull()
    .unique()
    .references(() => alliances.id, { onDelete: "cascade" }),
  appId: text("app_id").notNull(),
  originUrl: text("origin_url").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  registeredByDiscordUserId: text("registered_by_discord_user_id"),
  registeredByHqUserId: text("registered_by_hq_user_id").references(
    () => hqUsers.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Per-Discord-user bot preferences (locale). */
export const discordUserPrefs = pgTable("discord_user_prefs", {
  discordUserId: text("discord_user_id").primaryKey(),
  locale: text("locale").notNull().default("en-US"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Short-lived one-time nonces for the /discord/authorize HQ web redirect (Ashed credential setup). */
export const discordAuthNonces = pgTable("discord_auth_nonces", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull().unique(),
  discordUserId: text("discord_user_id").notNull(),
  /** Discord guild that initiated the setup flow. */
  guildId: text("guild_id"),
  /** Normalized lowercase alliance tag this nonce was issued for. */
  tag: text("tag").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Audit trail for all Discord bot interactions. */
export const discordBotAudit = pgTable("discord_bot_audit", {
  id: text("id").primaryKey(),
  allianceId: text("alliance_id")
    .notNull()
    .references(() => alliances.id, { onDelete: "cascade" }),
  discordUserId: text("discord_user_id"),
  command: text("command").notNull(),
  payloadJson: jsonb("payload_json"),
  resultJson: jsonb("result_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type Alliance = typeof alliances.$inferSelect;
export type HqUser = typeof hqUsers.$inferSelect;
export type AllianceMembership = typeof allianceMemberships.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type CredentialPairingCode = typeof credentialPairingCodes.$inferSelect;
export type LinkedDevice = typeof linkedDevices.$inferSelect;
export type AshedCredential = typeof ashedCredentials.$inferSelect;
export type VideoUploadGroup = typeof videoUploadGroups.$inferSelect;
export type VideoJob = typeof videoJobs.$inferSelect;
export type VideoFrame = typeof videoFrames.$inferSelect;
export type ParseSession = typeof parseSessions.$inferSelect;
export type ParsedRow = typeof parsedRows.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferInsert;
export type DiscordAuthNonce = typeof discordAuthNonces.$inferSelect;
export type HqEventSeries = typeof hqEventSeries.$inferSelect;
export type HqEvent = typeof hqEvents.$inferSelect;
export type HqEventBoard = typeof hqEventBoards.$inferSelect;
export type HqCommendation = typeof hqCommendations.$inferSelect;
export type HqEventMember = typeof hqEventMembers.$inferSelect;

export const surveyFeedback = pgTable("survey_feedback", {
  id: text("id").primaryKey(),
  hqUserId: text("hq_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
  allianceId: text("alliance_id"),
  videoJobId: text("video_job_id").references(() => videoJobs.id, {
    onDelete: "set null",
  }),
  source: text("source").notNull(),
  positiveExperience: integer("positive_experience"),
  feedback: text("feedback"),
  outreachConsent: integer("outreach_consent"),
  isComplete: integer("is_complete").notNull().default(0),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  locale: text("locale"),
  pagePath: text("page_path"),
  appVersion: text("app_version"),
  browserVersion: text("browser_version"),
  osVersion: text("os_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const userFeedbackReport = pgTable("user_feedback_report", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("bug"),
  status: text("status").notNull().default("open"),
  hqUserId: text("hq_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
  allianceId: text("alliance_id"),
  subject: text("subject"),
  description: text("description").notNull(),
  area: text("area"),
  severity: integer("severity"),
  pageUrl: text("page_url"),
  locale: text("locale"),
  appVersion: text("app_version"),
  browserVersion: text("browser_version"),
  osVersion: text("os_version"),
  consoleLogs: text("console_logs"),
  captureSessionId: text("capture_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const bugReportScreenshot = pgTable("bug_report_screenshot", {
  id: text("id").primaryKey(),
  reportId: text("report_id")
    .notNull()
    .references(() => userFeedbackReport.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const translationCorrectionReports = pgTable(
  "translation_correction_reports",
  {
    id: text("id").primaryKey(),
    hqUserId: text("hq_user_id")
      .notNull()
      .references(() => hqUsers.id, { onDelete: "cascade" }),
    allianceId: text("alliance_id"),
    locale: text("locale").notNull(),
    i18nKey: text("i18n_key"),
    candidateKeys: jsonb("candidate_keys").$type<string[]>(),
    displayedText: text("displayed_text").notNull(),
    suggestedTranslation: text("suggested_translation").notNull(),
    pagePath: text("page_path"),
    status: text("status").notNull().default("pending"),
    reviewedBy: text("reviewed_by").references(() => hqUsers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    adminNotes: text("admin_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
);

export const hqPlatformCommendations = pgTable("hq_platform_commendations", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  category: text("category").notNull().default("translation"),
  thresholdType: text("threshold_type").notNull(),
  thresholdValue: integer("threshold_value").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer("active").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const hqUserPlatformCommendations = pgTable(
  "hq_user_platform_commendations",
  {
    id: text("id").primaryKey(),
    hqUserId: text("hq_user_id")
      .notNull()
      .references(() => hqUsers.id, { onDelete: "cascade" }),
    commendationId: text("commendation_id")
      .notNull()
      .references(() => hqPlatformCommendations.id, { onDelete: "cascade" }),
    awardedAt: timestamp("awarded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => [
    unique("hq_user_platform_commendations_user_slug_unique").on(
      table.hqUserId,
      table.commendationId,
    ),
  ],
);

export type SurveyFeedback = typeof surveyFeedback.$inferSelect;
export type UserFeedbackReport = typeof userFeedbackReport.$inferSelect;
export type BugReportScreenshot = typeof bugReportScreenshot.$inferSelect;
export type TranslationCorrectionReport =
  typeof translationCorrectionReports.$inferSelect;
export type HqPlatformCommendation = typeof hqPlatformCommendations.$inferSelect;
export type HqUserPlatformCommendation =
  typeof hqUserPlatformCommendations.$inferSelect;
export type DiscordMemberLink = typeof discordMemberLinks.$inferSelect;
export type MemberSeasonVr = typeof memberSeasonVr.$inferSelect;
export type DiscordBotPending = typeof discordBotPending.$inferSelect;
export type DiscordBotAudit = typeof discordBotAudit.$inferSelect;
export type DiscordGuildAlliance = typeof discordGuildAlliances.$inferSelect;
export type AllianceAshedCredential = typeof allianceAshedCredentials.$inferSelect;
export type DiscordUserPref = typeof discordUserPrefs.$inferSelect;
export type VideoJobSurvey = typeof videoJobSurveys.$inferSelect;

/** Locally synced Ashed roster — normalized ranks for trains and Members UI. */
export const allianceMembers = pgTable(
  "alliance_members",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    ashedMemberId: text("ashed_member_id").notNull(),
    ashedAllianceId: text("ashed_alliance_id").notNull(),
    currentName: text("current_name").notNull(),
    previousNamesJson: jsonb("previous_names_json").$type<string[]>(),
    status: text("status").notNull().default("active"),
    /** Normalized in-game rank (1–5) parsed at sync or rank confirm. */
    allianceRank: integer("alliance_rank"),
    allianceRankTitle: text("alliance_rank_title"),
    /** Raw Ashed Member.rank string for display / round-trip. */
    ashedRankRaw: text("ashed_rank_raw"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("alliance_members_alliance_ashed_member_unique").on(
      table.allianceId,
      table.ashedMemberId,
    ),
  ],
);

/** Immutable alliance rank history (R1–R5). Append-only. */
export const memberAllianceRankEvents = pgTable(
  "member_alliance_rank_events",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    ashedMemberId: text("ashed_member_id").notNull(),
    memberName: text("member_name").notNull(),
    allianceRank: integer("alliance_rank").notNull(),
    allianceRankTitle: text("alliance_rank_title"),
    effectiveDate: text("effective_date").notNull(),
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    recordedByHqUserId: text("recorded_by_hq_user_id").references(
      () => hqUsers.id,
      { onDelete: "set null" },
    ),
    ashedSyncedAt: timestamp("ashed_synced_at", { withTimezone: true }),
  },
);

export const trainWeekSchedules = pgTable(
  "train_week_schedules",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    seasonKey: text("season_key"),
    templateType: text("template_type").notNull(),
    notes: text("notes"),
    isPivot: integer("is_pivot").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("train_week_schedules_alliance_week_unique").on(
      table.allianceId,
      table.weekStart,
    ),
  ],
);

export const trainDayConfigs = pgTable(
  "train_day_configs",
  {
    id: text("id").primaryKey(),
    weekScheduleId: text("week_schedule_id").references(
      () => trainWeekSchedules.id,
      { onDelete: "cascade" },
    ),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    conductorMechanism: text("conductor_mechanism").notNull(),
    conductorConfig: jsonb("conductor_config"),
    vipMechanism: text("vip_mechanism"),
    vipConfig: jsonb("vip_config"),
    isOverride: integer("is_override").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("train_day_configs_alliance_date_unique").on(
      table.allianceId,
      table.date,
    ),
  ],
);

export const trainConductorRecords = pgTable(
  "train_conductor_records",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    seasonKey: text("season_key"),
    conductorMemberId: text("conductor_member_id"),
    conductorMemberName: text("conductor_member_name"),
    conductorRankEventId: text("conductor_rank_event_id").references(
      () => memberAllianceRankEvents.id,
      { onDelete: "set null" },
    ),
    vipMemberId: text("vip_member_id"),
    vipMemberName: text("vip_member_name"),
    vipRankEventId: text("vip_rank_event_id").references(
      () => memberAllianceRankEvents.id,
      { onDelete: "set null" },
    ),
    guardianIsVip: integer("guardian_is_vip").notNull().default(0),
    conductorMechanism: text("conductor_mechanism"),
    vipMechanism: text("vip_mechanism"),
    dayConfigId: text("day_config_id").references(() => trainDayConfigs.id, {
      onDelete: "set null",
    }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("train_conductor_records_alliance_date_unique").on(
      table.allianceId,
      table.date,
    ),
  ],
);

export const conductorPoolEntries = pgTable(
  "conductor_pool_entries",
  {
    id: text("id").primaryKey(),
    allianceId: text("alliance_id")
      .notNull()
      .references(() => alliances.id, { onDelete: "cascade" }),
    poolType: text("pool_type").notNull(),
    generation: integer("generation").notNull().default(1),
    memberId: text("member_id").notNull(),
    memberName: text("member_name").notNull(),
    allianceRank: integer("alliance_rank"),
    sequencePosition: integer("sequence_position"),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    selectedForDate: text("selected_for_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("conductor_pool_entries_unique").on(
      table.allianceId,
      table.poolType,
      table.generation,
      table.memberId,
    ),
  ],
);

export const inventoryItems = pgTable("inventory_item", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  trainValue: integer("train_value").notNull().default(0),
});

export const trains = pgTable(
  "train",
  {
    id: text("id").primaryKey(),
    conductorRecordId: text("conductor_record_id")
      .notNull()
      .references(() => trainConductorRecords.id, { onDelete: "cascade" }),
    cargoValueScore: integer("cargo_value_score").notNull().default(0),
    tradeContractsSpent: integer("trade_contracts_spent").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("train_conductor_record_unique").on(table.conductorRecordId),
  ],
);

export const trainCars = pgTable(
  "train_car",
  {
    id: text("id").primaryKey(),
    trainId: text("train_id")
      .notNull()
      .references(() => trains.id, { onDelete: "cascade" }),
    carNumber: integer("car_number").notNull(),
  },
  (table) => [
    unique("train_car_train_number_unique").on(table.trainId, table.carNumber),
  ],
);

export const trainCarCargoItems = pgTable(
  "train_car_cargo_item",
  {
    id: text("id").primaryKey(),
    trainCarId: text("train_car_id")
      .notNull()
      .references(() => trainCars.id, { onDelete: "cascade" }),
    slotNumber: integer("slot_number").notNull(),
    inventoryItemId: text("inventory_item_id").references(
      () => inventoryItems.id,
      { onDelete: "set null" },
    ),
    quantity: integer("quantity").notNull().default(0),
  },
  (table) => [
    unique("train_car_cargo_item_slot_unique").on(
      table.trainCarId,
      table.slotNumber,
    ),
  ],
);

export const trainCargoSnapshots = pgTable("train_cargo_snapshot", {
  id: text("id").primaryKey(),
  conductorRecordId: text("conductor_record_id")
    .notNull()
    .references(() => trainConductorRecords.id, { onDelete: "cascade" }),
  snapshotIndex: integer("snapshot_index").notNull(),
  cargoValueScore: integer("cargo_value_score").notNull().default(0),
  tradeContractsSpentCumulative: integer("trade_contracts_spent_cumulative")
    .notNull()
    .default(0),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const trainCargoSnapshotCars = pgTable(
  "train_cargo_snapshot_car",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => trainCargoSnapshots.id, { onDelete: "cascade" }),
    carNumber: integer("car_number").notNull(),
  },
  (table) => [
    unique("train_cargo_snapshot_car_unique").on(
      table.snapshotId,
      table.carNumber,
    ),
  ],
);

export const trainCargoSnapshotCarItems = pgTable(
  "train_cargo_snapshot_car_item",
  {
    id: text("id").primaryKey(),
    snapshotCarId: text("snapshot_car_id")
      .notNull()
      .references(() => trainCargoSnapshotCars.id, { onDelete: "cascade" }),
    slotNumber: integer("slot_number").notNull(),
    inventoryItemId: text("inventory_item_id").references(
      () => inventoryItems.id,
      { onDelete: "set null" },
    ),
    quantity: integer("quantity").notNull().default(0),
  },
  (table) => [
    unique("train_cargo_snapshot_car_item_slot_unique").on(
      table.snapshotCarId,
      table.slotNumber,
    ),
  ],
);

export const trainPlunderEvents = pgTable("train_plunder_event", {
  id: text("id").primaryKey(),
  conductorRecordId: text("conductor_record_id")
    .notNull()
    .references(() => trainConductorRecords.id, { onDelete: "cascade" }),
  plunderNumber: integer("plunder_number").notNull(),
  plunderedAt: timestamp("plundered_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const trainPlunderEventItems = pgTable("train_plunder_event_item", {
  id: text("id").primaryKey(),
  plunderEventId: text("plunder_event_id")
    .notNull()
    .references(() => trainPlunderEvents.id, { onDelete: "cascade" }),
  inventoryItemId: text("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  trainCarNumber: integer("train_car_number"),
});

export const trainRiders = pgTable("train_rider", {
  id: text("id").primaryKey(),
  conductorRecordId: text("conductor_record_id")
    .notNull()
    .references(() => trainConductorRecords.id, { onDelete: "cascade" }),
  memberId: text("member_id").notNull(),
  memberName: text("member_name").notNull(),
  carNumber: integer("car_number").notNull(),
  boardingResult: text("boarding_result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const trainRiderCargoItems = pgTable("train_rider_cargo_item", {
  id: text("id").primaryKey(),
  riderId: text("rider_id")
    .notNull()
    .references(() => trainRiders.id, { onDelete: "cascade" }),
  inventoryItemId: text("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  wasPlundered: integer("was_plundered").notNull().default(0),
});

export type AllianceMember = typeof allianceMembers.$inferSelect;
export type MemberAllianceRankEvent =
  typeof memberAllianceRankEvents.$inferSelect;
export type TrainWeekSchedule = typeof trainWeekSchedules.$inferSelect;
export type TrainDayConfig = typeof trainDayConfigs.$inferSelect;
export type TrainConductorRecord = typeof trainConductorRecords.$inferSelect;
export type ConductorPoolEntry = typeof conductorPoolEntries.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type Train = typeof trains.$inferSelect;
export type TrainCar = typeof trainCars.$inferSelect;
export type TrainCarCargoItem = typeof trainCarCargoItems.$inferSelect;
export type TrainCargoSnapshot = typeof trainCargoSnapshots.$inferSelect;
export type TrainPlunderEvent = typeof trainPlunderEvents.$inferSelect;
export type TrainRider = typeof trainRiders.$inferSelect;

// ---------------------------------------------------------------------------
// Experiment platform
// ---------------------------------------------------------------------------

export type ExtractionConfig = {
  mode: "scene" | "fps";
  sceneThreshold?: number;
  sampleFps?: number;
};

export const parseConfigs = pgTable("parse_configs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Machine key used in analytics grouping, e.g. "scene_0.33" */
  passKey: text("pass_key").notNull(),
  description: text("description"),
  configJson: jsonb("config_json").$type<ExtractionConfig>().notNull(),
  /** draft | active | archived */
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdByUserId: text("created_by_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
});

export const experimentCampaigns = pgTable("experiment_campaigns", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  hypothesis: text("hypothesis"),
  /** Required. Must match a known hqEvents.scoreTarget value. */
  scoreTarget: text("score_target").notNull(),
  /** null = all boards within the scoreTarget */
  boardKey: text("board_key"),
  /** draft | active | paused | concluded */
  status: text("status").notNull().default("draft"),
  /** 1–100: % of eligible uploads that enter this experiment */
  trafficPercent: integer("traffic_percent").notNull().default(100),
  startedAt: timestamp("started_at", { withTimezone: true }),
  concludedAt: timestamp("concluded_at", { withTimezone: true }),
  conclusion: text("conclusion"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdByUserId: text("created_by_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
});

export const experimentArms = pgTable("experiment_arms", {
  id: text("id").primaryKey(),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => experimentCampaigns.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isControl: boolean("is_control").notNull().default(false),
  /** null = arm uses default shadow behavior (no extra shadow pass) */
  configId: text("config_id").references(() => parseConfigs.id, {
    onDelete: "set null",
  }),
  /** Relative weight for arm assignment within the campaign */
  trafficWeight: integer("traffic_weight").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Production primary-pass overrides. Maps (scoreTarget, boardKey) → parseConfig.
 * Unique constraint enforced at the DB level. Null scoreTarget = global default.
 */
export const configAssignments = pgTable("config_assignments", {
  id: text("id").primaryKey(),
  scoreTarget: text("score_target"),
  boardKey: text("board_key"),
  configId: text("config_id")
    .notNull()
    .references(() => parseConfigs.id, { onDelete: "restrict" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdByUserId: text("created_by_user_id").references(() => hqUsers.id, {
    onDelete: "set null",
  }),
});

export type ParseConfig = typeof parseConfigs.$inferSelect;
export type ExperimentCampaign = typeof experimentCampaigns.$inferSelect;
export type ExperimentArm = typeof experimentArms.$inferSelect;
export type ConfigAssignment = typeof configAssignments.$inferSelect;

