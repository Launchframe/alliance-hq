import type { ConductorRule, VipRule } from "@/lib/trains/rules/catalog.shared";

import type {
  VsDayResult,
  VsNormalizedResult,
  VsResultSource,
} from "./match-results.shared";
import { calculateVsWeekPoints } from "./match-results.shared";
import type {
  VsPlanDay,
  VsPlanDraft,
  VsPushDefaults,
} from "./weekly-plan.shared";
import type { WeeklyPifBoard } from "./weekly-pif.shared";

export type VsEffectiveDay = VsPlanDay & {
  trainDate: string;
  currentRule: ConductorRule | null;
  vipRule: VipRule | null;
  locked: boolean;
  editable: boolean;
  override: boolean;
  conductorName: string | null;
};

export type VsSavedDayResult = VsDayResult & {
  id: string;
  version: number;
  source: VsResultSource;
  hqConfirmed: boolean;
};

export type VsMatchupView = {
  id: string;
  version: number;
  opponentName: string | null;
  opponentTag: string | null;
  days: VsSavedDayResult[];
  conflicts: Array<{
    id: string;
    recordedDate: string;
    result: VsNormalizedResult;
    nativeVersion: number;
  }>;
};

export type VsPlanAppliedMeta = {
  appliedAt: string | null;
  leadDays: number;
  rules: Record<string, ConductorRule | null>;
};

export type VsWeekPayload = {
  weekStart: string;
  today: string;
  scope: string;
  contextScope: string;
  canEdit: boolean;
  leadDays: number;
  plan:
    | (VsPlanDraft & {
        version: number;
        leadDays: number;
        applied: VsPlanAppliedMeta | null;
      })
    | null;
  preferences: { version: number; defaults: VsPushDefaults };
  days: VsEffectiveDay[];
  matchup: VsMatchupView | null;
  points: ReturnType<typeof calculateVsWeekPoints>;
  pif: WeeklyPifBoard | null;
  pifError: string | null;
  canImportAshed: boolean;
};

export type VsPlanPreview = {
  fingerprint: string;
  planVersion: number;
  changes: Array<{
    scoreDate: string;
    trainDate: string;
    before: ConductorRule | null;
    after: ConductorRule;
    clearConductorName: string | null;
  }>;
  protectedDates: string[];
  scope: string;
};

export type VsActor = {
  sessionId: string;
  hqUserId: string | null;
  allianceId: string;
};

export type TrustedVsResultEvidence = {
  kind: VsResultSource;
  sourceRef?: string | null;
  sourceRevision?: string | null;
  reviewJobId?: string | null;
};
