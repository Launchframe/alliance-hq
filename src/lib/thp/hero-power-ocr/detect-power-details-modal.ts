/**
 * Resolve the Power Details modal crop for geometry-first OCR.
 *
 * Tries grey connected-component detection, scores fallback presets with a
 * cheap label-band OCR probe, and returns the best-scoring candidate.
 */

import {
  detectGameModalRect,
  modalRectFromPreset,
  type CropRect,
} from "@/lib/ocr/game-modal-detect.shared";
import type { CropCandidateScore } from "@/lib/ocr/screenshot-ocr-quality.shared";
import { runTesseract } from "@/lib/members/roster-ocr/tesseract";
import { matchThpLabel } from "@/lib/thp/breakdown.shared";
import {
  isHeroPowerHeaderLabel,
  isPowerDetailsModalTitle,
} from "@/lib/thp/hero-power-ocr/parse-power-details-geometry.shared";
import {
  bandWithinModal,
  POWER_DETAILS_LABEL_BAND,
  POWER_DETAILS_LABEL_OCR_CONFIG,
  POWER_DETAILS_MODAL_CROP,
  POWER_DETAILS_PC_CENTERED_CROP,
} from "@/lib/thp/hero-power-ocr/preprocess-power-details";

export type PowerDetailsModalResolution = {
  modal: CropRect;
  method: string;
  confidence: number;
  candidates: CropCandidateScore[];
};

type ModalCandidate = {
  method: string;
  modal: CropRect;
  baseConfidence: number;
};

const PROBE_SCALE = 1.75;

function scoreLabelProbeHits(lines: string[]): number {
  let hits = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isPowerDetailsModalTitle(trimmed)) {
      hits += 1;
      continue;
    }
    if (isHeroPowerHeaderLabel(trimmed)) {
      hits += 2;
      continue;
    }
    if (matchThpLabel(trimmed) != null) {
      hits += 1;
    }
  }
  return hits;
}

async function probeLabelBandHits(
  buffer: Buffer,
  modal: CropRect,
): Promise<number> {
  const sharp = (await import("sharp")).default;
  const labelCrop = bandWithinModal(modal, POWER_DETAILS_LABEL_BAND);
  const targetWidth = Math.max(1, Math.round(labelCrop.width * PROBE_SCALE));
  const targetHeight = Math.max(1, Math.round(labelCrop.height * PROBE_SCALE));

  const probeBuffer = await sharp(buffer)
    .extract(labelCrop)
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale()
    .normalize({ lower: 2, upper: 98 })
    .sharpen({ sigma: 0.45 })
    .png()
    .toBuffer();

  const lines = await runTesseract(probeBuffer, {
    ...POWER_DETAILS_LABEL_OCR_CONFIG,
    preprocessScale: 1,
    tesseractPsm: 6,
  });
  return scoreLabelProbeHits(lines.map((line) => line.text));
}

function buildCandidateList(
  srcWidth: number,
  srcHeight: number,
  detected: Awaited<ReturnType<typeof detectGameModalRect>>,
): ModalCandidate[] {
  const candidates: ModalCandidate[] = [];

  if (detected) {
    candidates.push({
      method: detected.method,
      modal: detected.rect,
      baseConfidence: detected.confidence,
    });
  }

  const mobile = modalRectFromPreset(
    srcWidth,
    srcHeight,
    POWER_DETAILS_MODAL_CROP,
    "fallback_preset",
  );
  candidates.push({
    method: "mobile_portrait_preset",
    modal: mobile.rect,
    baseConfidence: mobile.confidence,
  });

  const pc = modalRectFromPreset(
    srcWidth,
    srcHeight,
    POWER_DETAILS_PC_CENTERED_CROP,
    "fallback_preset",
  );
  candidates.push({
    method: "pc_centered_preset",
    modal: pc.rect,
    baseConfidence: pc.confidence,
  });

  return candidates;
}

/**
 * Select the best Power Details modal rect for downstream band crops.
 */
export async function resolvePowerDetailsModal(
  buffer: Buffer,
): Promise<PowerDetailsModalResolution> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buffer).metadata();
  const srcWidth = meta.width ?? 1080;
  const srcHeight = meta.height ?? 1920;

  const detected = await detectGameModalRect(buffer);
  const candidates = buildCandidateList(srcWidth, srcHeight, detected);

  const scored: Array<CropCandidateScore & { modal: CropRect; confidence: number }> =
    [];

  for (const candidate of candidates) {
    const labelHits = await probeLabelBandHits(buffer, candidate.modal);
    const score =
      labelHits * 0.12 +
      candidate.baseConfidence * 0.35 +
      (candidate.method === "grey_cc" ? 0.08 : 0);
    scored.push({
      method: candidate.method,
      labelHits,
      score,
      modal: candidate.modal,
      confidence: candidate.baseConfidence,
    });
  }

  scored.sort((a, b) => b.score - a.score || b.labelHits - a.labelHits);
  const best = scored[0]!;

  return {
    modal: best.modal,
    method: best.method,
    confidence: best.confidence,
    candidates: scored.map(({ method, labelHits, score }) => ({
      method,
      labelHits,
      score,
    })),
  };
}
