export type VideoProcessorEligibilityMode =
  | "ashed_connected_officers"
  | "native_r4_r5";

export type VideoProcessorCandidate = {
  hqUserId: string;
  email: string;
  displayName: string | null;
  subtitle: string | null;
};

export type VideoProcessorCandidateList = {
  candidates: VideoProcessorCandidate[];
  eligibilityMode: VideoProcessorEligibilityMode;
};

export function videoProcessorEligibilityModeForOperatingMode(
  operatingMode: "ashed" | "native" | null,
): VideoProcessorEligibilityMode {
  return operatingMode === "native"
    ? "native_r4_r5"
    : "ashed_connected_officers";
}

/**
 * Ashed-connected officers can enqueue and view the queue, but approve/reject
 * still requires an explicit processor slot (owners/maintainers bypass).
 */
export function shouldShowVideoProcessorRoleHint(input: {
  ashedConnected: boolean;
  canProcess: boolean;
  roleName: string | null | undefined;
}): boolean {
  return (
    input.ashedConnected &&
    !input.canProcess &&
    input.roleName === "officer"
  );
}
