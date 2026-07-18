import "server-only";

import QRCode from "qrcode";

import { renderSvgToPng } from "@/lib/charts/render-chart-png.server";
import {
  buildStoreTipBadgeSvg,
  STORE_TIP_BADGE_HEIGHT,
  STORE_TIP_BADGE_WIDTH,
} from "@/lib/members/store-tip-badge.shared";

export async function buildQrModules(payloadUrl: string): Promise<boolean[][]> {
  const matrix = QRCode.create(payloadUrl, { errorCorrectionLevel: "M" });
  const size = matrix.modules.size;
  const modules: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) {
      row.push(Boolean(matrix.modules.get(x, y)));
    }
    modules.push(row);
  }
  return modules;
}

export async function renderStoreTipBadgePng(input: {
  headline: string;
  commanderName: string;
  allianceTag: string | null;
  shortUrlDisplay: string;
  qrPayloadUrl: string;
}): Promise<Buffer> {
  const qrModules = await buildQrModules(input.qrPayloadUrl);
  const svg = buildStoreTipBadgeSvg({
    ...input,
    qrModules,
    width: STORE_TIP_BADGE_WIDTH,
    height: STORE_TIP_BADGE_HEIGHT,
  });
  return renderSvgToPng(svg);
}
