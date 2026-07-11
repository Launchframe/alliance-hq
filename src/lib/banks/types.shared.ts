export const DEPOSIT_POLICIES = ["alliance", "warzone", "public"] as const;
export type DepositPolicy = (typeof DEPOSIT_POLICIES)[number];

export const DEPOSIT_TERMS = [1, 3, 5] as const;
export type DepositTermDays = (typeof DEPOSIT_TERMS)[number];

export const DEPOSIT_STATUSES = ["locked", "matured", "looted"] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];

export const BATTLE_PLAN_EVENT_TYPES = ["capture", "drop"] as const;
export type BattlePlanEventType = (typeof BATTLE_PLAN_EVENT_TYPES)[number];

export type SerializedBank = {
  id: string;
  gameServerNumber: number;
  coordX: number;
  coordY: number;
  level: number;
  capturedAt: string | null;
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
  depositAllianceTag: string | null;
  depositAllianceId: string | null;
  commanderName: string;
  commanderId: string | null;
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
  effectiveSeasonKey?: string;
  nextCaptureLevel: number | null;
};
