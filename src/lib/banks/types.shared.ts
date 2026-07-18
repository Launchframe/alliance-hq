/**
 * In-game deposit slot capacity by bank level.
 * Levels 1–5: 100 slots. Level 6+: 110 slots.
 */
export function bankDepositCapacity(level: number): number {
  return level >= 6 ? 110 : 100;
}

export const DEPOSIT_POLICIES = ["alliance", "warzone", "public"] as const;
export type DepositPolicy = (typeof DEPOSIT_POLICIES)[number];

export const DEPOSIT_TERMS = [1, 3, 5] as const;
export type DepositTermDays = (typeof DEPOSIT_TERMS)[number];

export const DEPOSIT_STATUSES = ["locked", "matured", "looted"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const BATTLE_PLAN_EVENT_TYPES = ["capture", "drop"] as const;
export type BattlePlanEventType = (typeof BATTLE_PLAN_EVENT_TYPES)[number];

/** Default bank protection duration: 3 days and 12 hours. */
export const BANK_PROTECTION_DURATION_MS = (3 * 24 + 12) * 60 * 60 * 1000;

export type SerializedBank = {
  id: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  capturedAt: string | null;
  protectionExpiresAt: string | null;
  dropByAt: string | null;
  depositPolicy: DepositPolicy | null;
  priorCaptureCount: number;
  currentDepositCount: number | null;
  currentDepositValue: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SerializedDepositSlip = {
  id: string;
  bankId: string;
  depositAt: string;
  termDays: DepositTermDays;
  maturesAt: string;
  status: DepositStatus;
  outcomeAt: string | null;
  amount: number;
  outcomeAmount: number | null;
  depositAllianceTag: string | null;
  depositAllianceId: string | null;
  commanderName: string;
  commanderId: string | null;
  allianceMemberId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BankWithSlips = SerializedBank & {
  depositSlips: SerializedDepositSlip[];
};

export type RecommendedDropMetrics = {
  bankId: string;
  bank: SerializedBank;
  valueAtRisk: number;
  countAtRisk: number;
  hoursUntilAllMature: number | null;
  reasons: string[];
};

export type RiskHeatmapCell = {
  hourStartIso: string;
  countAtRisk: number;
  valueAtRisk: number;
  /** 0 = best (green), 1 = worst (red). */
  intensity: number;
};

export type BankManagementPayload = {
  banks: BankWithSlips[];
  recommendation: RecommendedDropMetrics | null;
  heatmaps: Record<string, RiskHeatmapCell[]>;
  canWrite: boolean;
  todayServerDate: string;
  /** Session alliance — scopes City List import drafts and tenant context. */
  allianceId: string;
  effectiveSeasonKey?: string;
  nextCaptureLevel: number | null;
  /** Prefill for new bank forms from the session alliance. */
  allianceGameServerNumber: number | null;
  /** From the most recently imported City List screenshot, if any. */
  bankCapturesRemainingToday: number | null;
  bankCapturesLimitToday: number | null;
  bankCityListServerTime: string | null;
};

/** Deposit falloff projection horizons offered in the chart control. */
export const FALLOFF_HORIZON_HOURS_OPTIONS = [24, 72, 120] as const;
export type FalloffHorizonHours = (typeof FALLOFF_HORIZON_HOURS_OPTIONS)[number];
export const DEFAULT_FALLOFF_HORIZON_HOURS: FalloffHorizonHours = 72;
export const DEFAULT_FALLOFF_STEP_HOURS = 1;

/** A single bank vs. the alliance-wide rollup across all held banks. */
export const DEPOSIT_FALLOFF_SCOPES = ["bank", "alliance"] as const;
export type DepositFalloffScope = (typeof DEPOSIT_FALLOFF_SCOPES)[number];

/**
 * One hourly sample of the deposit falloff curve — either the live
 * maturity-only projection or the reconstructed historical actual.
 */
export type FalloffPoint = {
  hourStartIso: string;
  /** Sum of `amount` for deposits still locked (at risk) at this hour. */
  lockedValue: number;
  /** Count of deposits still locked at this hour. */
  lockedCount: number;
  /** Sum of `amount` for deposits maturing within this hour's bucket. */
  maturingValue: number;
};

/** A named snapshot of a projected falloff curve, saved for later comparison against actuals. */
export type SerializedDepositProjection = {
  id: string;
  /** Bank-scoped projection's bank id, or null for an alliance-wide rollup. */
  bankId: string | null;
  scope: DepositFalloffScope;
  name: string;
  notes: string | null;
  horizonHours: FalloffHorizonHours;
  stepHours: number;
  /** The projected series as computed at save time (`buildDepositFalloffSeries`). */
  points: FalloffPoint[];
  createdAt: string;
  createdBy: string | null;
};

/**
 * Comparison of a saved projection against what actually happened, computed by
 * `summarizeProjectionVsActual`. All values are in CrystalGold except where noted.
 */
export type ProjectionVsActualSummary = {
  /** actual − projected locked value at the final aligned hour (>0 = more stayed locked than planned). */
  finalDelta: number;
  /** Largest amount actual locked value exceeded the projection at any aligned hour (>=0). */
  maxPositiveError: number;
  /** Sum of locked-value increases between consecutive actual hours (new deposits the projection couldn't see). */
  unexpectedInflow: number;
  /** Largest amount actual locked value fell short of the projection at any aligned hour (>=0; early maturity/loot). */
  earlyLootValue: number;
};

/** GET /api/banks/[id]/deposit-falloff and GET /api/banks/deposit-falloff */
export type DepositFalloffLiveResponse = {
  points: FalloffPoint[];
};

/** GET /api/banks/deposit-projections */
export type DepositProjectionListResponse = {
  projections: SerializedDepositProjection[];
};

/** POST /api/banks/deposit-projections */
export type DepositProjectionCreatePayload = {
  bankId: string | null;
  scope: DepositFalloffScope;
  name: string;
  notes?: string | null;
  horizonHours: FalloffHorizonHours;
  stepHours?: number;
  /** Ignored on create — server recomputes via `buildDepositFalloffSeries`. */
  points?: FalloffPoint[];
};

/** GET /api/banks/deposit-projections/[id] */
export type DepositProjectionDetailResponse = {
  projection: SerializedDepositProjection;
  actualPoints: FalloffPoint[];
  deltas: ProjectionVsActualSummary;
};

/** POST /api/banks/deposit-projections response. */
export type DepositProjectionCreateResponse = {
  projection: SerializedDepositProjection;
};
