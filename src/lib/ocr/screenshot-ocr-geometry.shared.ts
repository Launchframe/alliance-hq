import type { ThpBreakdownKey } from "@/lib/thp/breakdown.shared";
import type { CropRect } from "@/lib/ocr/game-modal-detect.shared";

export type BboxRect = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ScreenshotOcrFieldKey =
  | "TOTAL_HERO_POWER"
  | "HERO_LEVEL"
  | "DECORATIONS_AND_BUILDINGS"
  | "GEAR"
  | "EXCLUSIVE_WEAPON"
  | "HERO_TIER"
  | "HERO_SKILL"
  | "WALL_OF_HONOR"
  | "MODAL"
  | "UNMATCHED_VALUE";

export type ScreenshotOcrBboxOverlay = {
  index: number;
  fieldKey: ScreenshotOcrFieldKey;
  rect: BboxRect;
  parsedText?: string;
  parsedValue?: number | null;
  role: "header" | "value" | "modal" | "label";
};

const BREAKDOWN_FIELD_KEYS: Record<ThpBreakdownKey, ScreenshotOcrFieldKey> = {
  heroLevel: "HERO_LEVEL",
  decorationsAndBuildings: "DECORATIONS_AND_BUILDINGS",
  gear: "GEAR",
  exclusiveWeapons: "EXCLUSIVE_WEAPON",
  heroTier: "HERO_TIER",
  heroSkill: "HERO_SKILL",
  wallOfHonor: "WALL_OF_HONOR",
};

export function breakdownKeyToFieldKey(
  key: ThpBreakdownKey,
): ScreenshotOcrFieldKey {
  return BREAKDOWN_FIELD_KEYS[key];
}

export function mapCropBboxToSource(
  bbox: BboxRect,
  crop: CropRect,
  cropWidth: number,
  cropHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): BboxRect {
  const scaleX = crop.width / Math.max(1, cropWidth);
  const scaleY = crop.height / Math.max(1, cropHeight);
  return {
    x0: clamp(
      crop.left + bbox.x0 * scaleX,
      0,
      sourceWidth,
    ),
    y0: clamp(crop.top + bbox.y0 * scaleY, 0, sourceHeight),
    x1: clamp(crop.left + bbox.x1 * scaleX, 0, sourceWidth),
    y1: clamp(crop.top + bbox.y1 * scaleY, 0, sourceHeight),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function modalRectToBbox(modal: CropRect): BboxRect {
  return {
    x0: modal.left,
    y0: modal.top,
    x1: modal.left + modal.width,
    y1: modal.top + modal.height,
  };
}

export function remapOverlayToModalLocal(
  overlay: ScreenshotOcrBboxOverlay,
  modal: CropRect,
): ScreenshotOcrBboxOverlay {
  return {
    ...overlay,
    rect: {
      x0: overlay.rect.x0 - modal.left,
      y0: overlay.rect.y0 - modal.top,
      x1: overlay.rect.x1 - modal.left,
      y1: overlay.rect.y1 - modal.top,
    },
  };
}

export function sortOverlaysByTop(
  overlays: ScreenshotOcrBboxOverlay[],
): ScreenshotOcrBboxOverlay[] {
  return [...overlays].sort((a, b) => a.rect.y0 - b.rect.y0);
}

export function assignOverlayIndices(
  overlays: ScreenshotOcrBboxOverlay[],
): ScreenshotOcrBboxOverlay[] {
  let index = 1;
  return sortOverlaysByTop(overlays).map((overlay) => {
    if (overlay.fieldKey === "MODAL") {
      return { ...overlay, index: 0 };
    }
    const numbered = { ...overlay, index };
    index += 1;
    return numbered;
  });
}
