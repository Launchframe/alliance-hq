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
