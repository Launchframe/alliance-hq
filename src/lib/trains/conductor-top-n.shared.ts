/**
 * Parameterized Top VS / Top VR conductor scopes.
 * Legacy `vs_high_score` / `vs_top_10` map to VS topN 1 / 10.
 */

export const VS_TOP_N_SCOPES = [1, 3, 5, 10] as const;
export const VR_TOP_N_SCOPES = [3, 5, 10] as const;

export type VsTopN = (typeof VS_TOP_N_SCOPES)[number];
export type VrTopN = (typeof VR_TOP_N_SCOPES)[number];
export type ConductorTopN = VsTopN | VrTopN;

export type ConductorTopNBoardKind = "vs" | "vr";

export type ResolvedConductorTopNBoard = {
  kind: ConductorTopNBoardKind;
  topN: ConductorTopN;
  /** Original stored mechanism (may be legacy). */
  mechanism: string;
};

export function isVsTopN(value: number): value is VsTopN {
  return (VS_TOP_N_SCOPES as readonly number[]).includes(value);
}

export function isVrTopN(value: number): value is VrTopN {
  return (VR_TOP_N_SCOPES as readonly number[]).includes(value);
}

export function parseConductorConfigTopN(
  conductorConfig: unknown,
): number | null {
  if (!conductorConfig || typeof conductorConfig !== "object") return null;
  const topN = (conductorConfig as { topN?: unknown }).topN;
  if (typeof topN !== "number" || !Number.isInteger(topN) || topN < 1) {
    return null;
  }
  return topN;
}

/**
 * Resolve VS/VR top-N board for rolls, spin source, and labels.
 * Legacy mechanisms map without requiring conductor_config.topN.
 */
export function resolveConductorTopNBoard(
  mechanism: string | null | undefined,
  conductorConfig?: unknown,
): ResolvedConductorTopNBoard | null {
  if (!mechanism) return null;

  if (mechanism === "vs_high_score") {
    return { kind: "vs", topN: 1, mechanism };
  }
  if (mechanism === "vs_top_10") {
    return { kind: "vs", topN: 10, mechanism };
  }

  const configured = parseConductorConfigTopN(conductorConfig);

  if (mechanism === "vs_top_n") {
    const topN = configured != null && isVsTopN(configured) ? configured : 10;
    return { kind: "vs", topN, mechanism };
  }

  if (mechanism === "vr_top_n") {
    const topN = configured != null && isVrTopN(configured) ? configured : 3;
    return { kind: "vr", topN, mechanism };
  }

  return null;
}

/** True when Top VR scope N may be painted / rolled (`reporterCount >= 2 × N`). */
export function isVrTopScopeUnlocked(
  topN: number,
  reporterCount: number,
): boolean {
  if (!Number.isFinite(topN) || topN < 1) return false;
  return reporterCount >= 2 * topN;
}

/** Minimum VR reporters required to unlock scope N. */
export function vrReportersRequiredForTopN(topN: number): number {
  return 2 * topN;
}

export function defaultTopNForPaintTemplate(
  paintTemplate: string,
): ConductorTopN {
  if (paintTemplate === "top_vr") return 3;
  return 10;
}

export function isTopNPaintTemplate(
  template: string | null | undefined,
): template is "top_vs" | "top_vr" {
  return template === "top_vs" || template === "top_vr";
}

export function scopesForPaintTemplate(
  paintTemplate: "top_vs" | "top_vr",
): readonly ConductorTopN[] {
  return paintTemplate === "top_vr" ? VR_TOP_N_SCOPES : VS_TOP_N_SCOPES;
}

/** Auto-assign (no wheel) when Top VS/VR scope is 1. */
export function isAutomaticTopNBoard(
  board: ResolvedConductorTopNBoard | null,
): boolean {
  return board != null && board.topN === 1;
}
