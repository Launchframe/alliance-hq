/**
 * Pre-process Power Details screenshots for geometry-first OCR.
 *
 * ## Layout assumptions (phone screenshot, portrait modal)
 *
 * The Power Details card is a centered modal. Percents below are of the
 * **source image**, then of the **modal crop**:
 *
 * | Region        | Assumption |
 * |---------------|------------|
 * | Modal         | left 6%, top 11%, width 88%, height 55% (clears status/resource strip) |
 * | Label column  | left 0–60% of the modal (row names) |
 * | Value column  | right 55–100% of the modal (right-aligned numbers; slight overlap with labels is OK) |
 * | Header value  | top ~18% of modal × right 45–100%, inverted (fallback — prefer top value-column line) |
 *
 * ## Why columns instead of full-modal freeform OCR
 *
 * Tesseract treated thousand-commas as digits (`164,615,505` → `164376153505`).
 * Value crops use a **digits-only** whitelist so commas never enter the
 * character set and cannot become `1`/`3`/`7`/`5`.
 *
 * Labels keep a letter-heavy whitelist so `THP_LABEL_ALIASES` can map locales
 * (EN/DE/pt-BR/KO/es-MX). Row order is not assumed fixed — geometry only
 * pairs label↔value by y-center.
 */

import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";
import type { RosterOcrConfig } from "@/lib/members/roster-ocr/types";

export type { CropRect };

export type PowerDetailsPreprocessResult = {
  buffer: Buffer;
  width: number;
  height: number;
};

export type PowerDetailsModalContext = {
  srcWidth: number;
  srcHeight: number;
  modal: CropRect;
};

/** Label column: letters + light punctuation. Digits are allowed so OCR does not
 *  drop lines that mix glyphs, but values are read from the value column. */
// Latin + digits for EN/DE/pt-BR/es-MX labels. Korean (Hangul) needs `kor`
// traineddata on the worker — aliases exist in breakdown.shared, but eng-only
// OCR will not emit Hangul glyphs reliably.
const POWER_DETAILS_LABEL_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
  "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ" +
  "0123456789&.,:'`´’′/-_[](){}%!?#@+\" ";

/**
 * Value column / header value: digits only.
 *
 * Assumption: with commas excluded from the whitelist, Tesseract skips
 * thousand-separators instead of emitting confusable digits. Output is a
 * contiguous digit string (`85868520`), not a comma-repaired blob.
 */
export const POWER_DETAILS_DIGITS_WHITELIST = "0123456789";

/** @deprecated Prefer LABEL/VALUE/HEADER_VALUE configs. */
const POWER_DETAILS_CHAR_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" +
  "&.,:'`´’′/-_[](){}%!?#@+¥$€°\" ";

export const POWER_DETAILS_LABEL_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 2.75,
  tesseractPsm: 6,
  charWhitelist: POWER_DETAILS_LABEL_WHITELIST,
  minWordConfidence: 0,
};

export const POWER_DETAILS_VALUE_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 3,
  // Uniform block of right-aligned numbers stacked as a column.
  tesseractPsm: 6,
  charWhitelist: POWER_DETAILS_DIGITS_WHITELIST,
  minWordConfidence: 0,
};

export const POWER_DETAILS_HEADER_VALUE_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 3.25,
  // Single-line-ish total after invert + narrow crop.
  tesseractPsm: 7,
  charWhitelist: POWER_DETAILS_DIGITS_WHITELIST,
  minWordConfidence: 0,
};

/** @deprecated Full-modal freeform path — prefer LABEL/VALUE configs. */
export const POWER_DETAILS_BODY_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 2.75,
  tesseractPsm: 6,
  charWhitelist: POWER_DETAILS_CHAR_WHITELIST,
  minWordConfidence: 0,
};

/** @deprecated Prefer HEADER_VALUE config. */
export const POWER_DETAILS_HEADER_OCR_CONFIG: Partial<RosterOcrConfig> = {
  mode: "roster-ocr",
  preprocessScale: 3,
  tesseractPsm: 6,
  charWhitelist: POWER_DETAILS_CHAR_WHITELIST,
  minWordConfidence: 0,
};

/** @deprecated Prefer LABEL/VALUE configs. */
export const POWER_DETAILS_OCR_CONFIG = POWER_DETAILS_BODY_OCR_CONFIG;

/** Modal crop fractions of the full screenshot (documented above).
 * Top is high enough to clear the phone status / resource strip that sits
 * above the Power Details card on typical Last War screenshots. */
export const POWER_DETAILS_MODAL_CROP = {
  left: 0.06,
  top: 0.11,
  width: 0.88,
  height: 0.55,
} as const;

/** Centered PC / widescreen fallback when grey CC misses the panel. */
export const POWER_DETAILS_PC_CENTERED_CROP = {
  left: 0.18,
  top: 0.06,
  width: 0.64,
  height: 0.88,
} as const;

/** Label band as fractions of the modal width. */
export const POWER_DETAILS_LABEL_BAND = { left: 0, width: 0.6 } as const;

/**
 * Value band as fractions of the modal width.
 * Starts at 55% so right-aligned numbers are included even when labels are long
 * ("Decorations & Building Stats").
 */
export const POWER_DETAILS_VALUE_BAND = { left: 0.55, width: 0.45 } as const;

/** Header value cell: fractions of modal height × width. */
export const POWER_DETAILS_HEADER_VALUE_BAND = {
  top: 0.02,
  height: 0.18,
  left: 0.45,
  width: 0.55,
} as const;

type RelativeBand = { left: number; width: number; top?: number; height?: number };

type ModalPreset = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function modalCropBox(
  srcWidth: number,
  srcHeight: number,
  preset: ModalPreset = POWER_DETAILS_MODAL_CROP,
): CropRect {
  const cropLeft = Math.round(srcWidth * preset.left);
  const cropTop = Math.round(srcHeight * preset.top);
  const cropWidth = Math.round(srcWidth * preset.width);
  const cropHeight = Math.round(srcHeight * preset.height);
  return {
    left: Math.max(0, cropLeft),
    top: Math.max(0, cropTop),
    width: Math.min(cropWidth, srcWidth - cropLeft),
    height: Math.min(cropHeight, srcHeight - cropTop),
  };
}

export function bandWithinModal(modal: CropRect, band: RelativeBand): CropRect {
  const left = modal.left + Math.round(modal.width * band.left);
  const width = Math.round(modal.width * band.width);
  const top =
    band.top != null
      ? modal.top + Math.round(modal.height * band.top)
      : modal.top;
  const height =
    band.height != null
      ? Math.round(modal.height * band.height)
      : modal.height;
  return {
    left: Math.max(modal.left, left),
    top: Math.max(modal.top, top),
    width: Math.min(width, modal.left + modal.width - left),
    height: Math.min(height, modal.top + modal.height - top),
  };
}

export function getPowerDetailsBandCrops(modal: CropRect): {
  labelCrop: CropRect;
  valueCrop: CropRect;
  headerCrop: CropRect;
} {
  return {
    labelCrop: bandWithinModal(modal, POWER_DETAILS_LABEL_BAND),
    valueCrop: bandWithinModal(modal, POWER_DETAILS_VALUE_BAND),
    headerCrop: bandWithinModal(modal, POWER_DETAILS_HEADER_VALUE_BAND),
  };
}

async function readImageSize(input: Buffer): Promise<{ width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(input).metadata();
  return {
    width: meta.width ?? 1080,
    height: meta.height ?? 1920,
  };
}

function resolveModal(
  input: Buffer,
  modal?: CropRect,
): Promise<{ modal: CropRect; srcWidth: number; srcHeight: number }> {
  return readImageSize(input).then(({ width, height }) => ({
    modal: modal ?? modalCropBox(width, height),
    srcWidth: width,
    srcHeight: height,
  }));
}

async function extractScaledGreyscale(input: {
  buffer: Buffer;
  crop: CropRect;
  scale: number;
  invert?: boolean;
  normalizeLower?: number;
  normalizeUpper?: number;
  sharpenSigma?: number;
  /** Erase comma-sized ink after invert/normalize (value / header digits). */
  scrubSeparators?: boolean;
}): Promise<PowerDetailsPreprocessResult> {
  const sharp = (await import("sharp")).default;
  const targetWidth = Math.round(input.crop.width * input.scale);
  const targetHeight = Math.round(input.crop.height * input.scale);

  let pipeline = sharp(input.buffer)
    .extract(input.crop)
    .resize(targetWidth, targetHeight, { kernel: sharp.kernel.lanczos3 })
    .greyscale();

  if (input.invert) {
    pipeline = pipeline.negate();
  }

  pipeline = pipeline
    .normalize({
      lower: input.normalizeLower ?? 2,
      upper: input.normalizeUpper ?? 98,
    })
    .sharpen({ sigma: input.sharpenSigma ?? 0.55 });

  if (!input.scrubSeparators) {
    const buffer = await pipeline.png().toBuffer();
    return { buffer, width: targetWidth, height: targetHeight };
  }

  const { scrubSmallInkComponents } = await import(
    "@/lib/thp/hero-power-ocr/scrub-value-ink.shared"
  );
  const { data, info } = await pipeline
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scrubbed = scrubSmallInkComponents(
    Buffer.from(data),
    info.width,
    info.height,
  );
  const buffer = await sharp(scrubbed, {
    raw: { width: info.width, height: info.height, channels: 1 },
  })
    .png()
    .toBuffer();

  return { buffer, width: info.width, height: info.height };
}

/** Full modal soft greyscale — legacy freeform body pass. */
export async function preprocessPowerDetailsImage(
  input: Buffer,
  modal?: CropRect,
  scale = POWER_DETAILS_BODY_OCR_CONFIG.preprocessScale ?? 2.75,
): Promise<PowerDetailsPreprocessResult> {
  const { modal: resolvedModal } = await resolveModal(input, modal);
  return extractScaledGreyscale({
    buffer: input,
    crop: resolvedModal,
    scale,
    sharpenSigma: 0.55,
  });
}

/**
 * Top of modal inverted — legacy freeform header band.
 * Prefer {@link preprocessPowerDetailsHeaderValue} for digits-only totals.
 */
export async function preprocessPowerDetailsHeaderBand(
  input: Buffer,
  modal?: CropRect,
  scale = POWER_DETAILS_HEADER_OCR_CONFIG.preprocessScale ?? 3,
): Promise<PowerDetailsPreprocessResult> {
  const { modal: resolvedModal } = await resolveModal(input, modal);
  const headerHeight = Math.max(48, Math.round(resolvedModal.height * 0.22));
  const crop: CropRect = {
    left: resolvedModal.left,
    top: resolvedModal.top,
    width: resolvedModal.width,
    height: Math.min(headerHeight, resolvedModal.height),
  };
  return extractScaledGreyscale({
    buffer: input,
    crop,
    scale,
    invert: true,
    sharpenSigma: 0.6,
  });
}

/** Left column of the modal — row labels for `matchThpLabel`. */
export async function preprocessPowerDetailsLabelBand(
  input: Buffer,
  modal?: CropRect,
  scale = POWER_DETAILS_LABEL_OCR_CONFIG.preprocessScale ?? 2.75,
): Promise<PowerDetailsPreprocessResult> {
  const { modal: resolvedModal } = await resolveModal(input, modal);
  const crop = bandWithinModal(resolvedModal, POWER_DETAILS_LABEL_BAND);
  return extractScaledGreyscale({
    buffer: input,
    crop,
    scale,
    sharpenSigma: 0.55,
  });
}

/**
 * Right column — dark-on-light component digits (no invert).
 * Pair with {@link preprocessPowerDetailsValueBandInverted} for white-on-grey
 * section totals on the same column.
 */
export async function preprocessPowerDetailsValueBand(
  input: Buffer,
  modal?: CropRect,
  scale = POWER_DETAILS_VALUE_OCR_CONFIG.preprocessScale ?? 3,
): Promise<PowerDetailsPreprocessResult> {
  const { modal: resolvedModal } = await resolveModal(input, modal);
  const crop = bandWithinModal(resolvedModal, POWER_DETAILS_VALUE_BAND);
  return extractScaledGreyscale({
    buffer: input,
    crop,
    scale,
    invert: false,
    normalizeLower: 5,
    normalizeUpper: 95,
    sharpenSigma: 0.7,
    scrubSeparators: true,
  });
}

/**
 * Same value column, inverted — recovers white outlined totals on grey header
 * bars (Hero / Drone / Building section totals) that the non-inverted pass misses.
 */
export async function preprocessPowerDetailsValueBandInverted(
  input: Buffer,
  modal?: CropRect,
  scale = POWER_DETAILS_VALUE_OCR_CONFIG.preprocessScale ?? 3,
): Promise<PowerDetailsPreprocessResult> {
  const { modal: resolvedModal } = await resolveModal(input, modal);
  const crop = bandWithinModal(resolvedModal, POWER_DETAILS_VALUE_BAND);
  return extractScaledGreyscale({
    buffer: input,
    crop,
    scale,
    invert: true,
    normalizeLower: 5,
    normalizeUpper: 95,
    sharpenSigma: 0.7,
    // Scrub hurts white-outline digits on this pass; prefer raw invert.
    scrubSeparators: false,
  });
}

/**
 * Narrow inverted crop of the Hero Power total (right side of the header row).
 * Prefer the top digits-only line from {@link preprocessPowerDetailsValueBand}
 * when this crop misses (status-bar / aspect variance).
 */
export async function preprocessPowerDetailsHeaderValue(
  input: Buffer,
  modal?: CropRect,
  scale = POWER_DETAILS_HEADER_VALUE_OCR_CONFIG.preprocessScale ?? 3.25,
): Promise<PowerDetailsPreprocessResult> {
  const { modal: resolvedModal } = await resolveModal(input, modal);
  const crop = bandWithinModal(resolvedModal, POWER_DETAILS_HEADER_VALUE_BAND);
  return extractScaledGreyscale({
    buffer: input,
    crop,
    scale,
    invert: true,
    sharpenSigma: 0.65,
    scrubSeparators: true,
  });
}
