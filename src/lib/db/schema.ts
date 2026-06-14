import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userLabel: text("user_label"),
  allianceId: text("alliance_id"),
  /** In-game alliance tag, e.g. LFgo — resolves allianceId from global Alliance list */
  allianceTag: text("alliance_tag"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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

export const videoJobs = pgTable("video_jobs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

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

export type Session = typeof sessions.$inferSelect;
export type AshedCredential = typeof ashedCredentials.$inferSelect;
export type VideoJob = typeof videoJobs.$inferSelect;
export type VideoFrame = typeof videoFrames.$inferSelect;
export type ParseSession = typeof parseSessions.$inferSelect;
export type ParsedRow = typeof parsedRows.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferInsert;
export type HqEventSeries = typeof hqEventSeries.$inferSelect;
export type HqEvent = typeof hqEvents.$inferSelect;
export type HqEventBoard = typeof hqEventBoards.$inferSelect;
export type HqCommendation = typeof hqCommendations.$inferSelect;
export type HqEventMember = typeof hqEventMembers.$inferSelect;
