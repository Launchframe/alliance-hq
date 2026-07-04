import type { VideoOcrEngine } from "@/lib/video/ocr-provider.shared";
import { shouldEnqueueAshedOcrShadowPasses } from "@/lib/video/ocr-provider.shared";

export type VideoProcessShadowFollowup = {
  /** Stable id for i18n lookup under video.processAfterUpload.shadows.* */
  kind: "extraction_shadow" | "tesseract_shadow";
  /** When true, the follow-up may be skipped depending on runtime stats. */
  conditional: boolean;
};

export type VideoProcessExperimentOption = {
  campaignId: string;
  campaignName: string;
  armId: string;
  armName: string;
  isControl: boolean;
};

export type VideoProcessPreview = {
  jobId: string;
  status: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  scoreTarget: string | null;
  boardKey: string | null;
  passKey: string | null;
  primaryEngine: VideoOcrEngine;
  shadowFollowups: VideoProcessShadowFollowup[];
  experiment: VideoProcessExperimentOption | null;
  experimentOptions: VideoProcessExperimentOption[];
  hqOcrOnly: boolean;
  /** When true, the alliance cannot disable in-house OCR (deploy has no Ashed). */
  hqOcrOnlyLocked: boolean;
  requiresAshedConnection: boolean;
  canProcess: boolean;
};

export function buildVideoProcessShadowFollowups(params: {
  primaryEngine: VideoOcrEngine;
  isRosterTarget: boolean;
  experimentArmConfigId: string | null;
  hasExperimentAssignment: boolean;
}): VideoProcessShadowFollowup[] {
  if (!shouldEnqueueAshedOcrShadowPasses(params.primaryEngine)) {
    return [];
  }

  const followups: VideoProcessShadowFollowup[] = [];
  const includeExtractionShadow =
    !params.hasExperimentAssignment || params.experimentArmConfigId != null;

  if (includeExtractionShadow) {
    followups.push({
      kind: "extraction_shadow",
      conditional: true,
    });
  }

  if (params.isRosterTarget) {
    followups.push({
      kind: "tesseract_shadow",
      conditional: false,
    });
  }

  return followups;
}
