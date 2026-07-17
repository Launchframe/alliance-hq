import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockParseDepositSlipImage = vi.fn();

vi.mock(
  "@/lib/banks/deposit-slip-ocr/parse-deposit-slip-image.server",
  () => ({
    parseDepositSlipImage: (...args: unknown[]) =>
      mockParseDepositSlipImage(...args),
  }),
);

vi.mock("@/lib/ocr/ocr-diagnostics.shared", () => ({
  buildOcrDiagnostics: vi.fn(() => ({})),
  logOcrDiagnostics: vi.fn(),
}));

vi.mock("@/lib/video/pipeline-step-log", () => ({
  logPipelineStep: vi.fn(),
}));

import { ocrDepositSlipNativeFrames } from "@/lib/video/ocr-deposit-slip-native";

const BANK_INFO_LINES = [
  "Bank Information",
  "Lv.1",
  "#1203 [BigD]Trailblazer Bank",
  "City Owner: #1203 [BigD]Big Delinquents",
  "29,387/600,000",
];

const FAVORITES_LINES = [
  "ADD TO FAVORITES",
  "Warzone #1203 X:199 Y:599",
  "Lv.1 [BigD]Trailblazer Bank",
];

describe("ocrDepositSlipNativeFrames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("coalesces detectedBankContext from bank info and favorites OCR lines", async () => {
    mockParseDepositSlipImage
      .mockResolvedValueOnce({
        depositPolicy: null,
        minimumDeposit: null,
        slips: [],
        rawLines: BANK_INFO_LINES,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        depositPolicy: null,
        minimumDeposit: null,
        slips: [],
        rawLines: FAVORITES_LINES,
        durationMs: 1,
      });

    const result = await ocrDepositSlipNativeFrames([
      { index: 0, buffer: Buffer.from("frame-0") },
      { index: 1, buffer: Buffer.from("frame-1") },
    ]);

    expect(result.detectedBankContext).toEqual({
      gameServerNumber: 1203,
      coordX: 199,
      coordY: 599,
      level: 1,
      owningAllianceTag: "BigD",
      bankName: "Trailblazer Bank",
      currentDepositValue: 29_387,
      depositCapacity: 600_000,
      firstCaptureDate: null,
      sources: { bankInfo: true, favorites: true },
    });
  });

  it("returns null detectedBankContext when no bank context lines match", async () => {
    mockParseDepositSlipImage.mockResolvedValue({
      depositPolicy: null,
      minimumDeposit: null,
      slips: [],
      rawLines: ["Deposit Slip History", "No bank menu here"],
      durationMs: 1,
    });

    const result = await ocrDepositSlipNativeFrames([
      { index: 0, buffer: Buffer.from("frame-0") },
    ]);

    expect(result.detectedBankContext).toBeNull();
  });
});
