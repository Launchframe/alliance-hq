import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetHqMemberLinkForUser = vi.fn();
const mockGetCommanderIdForMember = vi.fn();
const mockParsePowerDetailsImage = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: (...args: unknown[]) =>
    mockGetHqMemberLinkForUser(...args),
}));

vi.mock("@/lib/thp/repository", () => ({
  getCommanderIdForMember: (...args: unknown[]) =>
    mockGetCommanderIdForMember(...args),
  getHqThpPending: vi.fn(),
  getCommanderThpState: vi.fn(),
  countAllianceThpReporters: vi.fn(),
  listAllianceCommanderThpRows: vi.fn(),
  saveHqThpPending: vi.fn(),
  upsertCommanderThp: vi.fn(),
}));

vi.mock("@/lib/discord/i18n", () => ({
  createDiscordTranslator: () => (key: string) => key,
}));

vi.mock("@/lib/thp/hero-power-ocr/parse-power-details-image", () => ({
  parsePowerDetailsImage: (...args: unknown[]) =>
    mockParsePowerDetailsImage(...args),
}));

import { handleWebThpCommand } from "@/lib/thp/web-thp.server";

describe("handleWebThpCommand screenshot OCR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHqMemberLinkForUser.mockResolvedValue({
      ashedMemberId: "ashed-1",
      memberDisplayName: "Commander",
    });
    mockGetCommanderIdForMember.mockResolvedValue("cmd-1");
  });

  it("returns ocrFailed when OCR header total is out of range and no rows parsed", async () => {
    mockParsePowerDetailsImage.mockResolvedValue({
      heroPowerTotal: 2_000_000_000,
      breakdown: {},
      complete: false,
    });

    const result = await handleWebThpCommand({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      locale: "en-US",
      screenshotBuffer: Buffer.from("fake-png"),
    });

    expect(result).toEqual({
      status: "error",
      message: "thp.ocrFailed",
    });
  });

  it("returns ocr_partial when some rows parse but total is unusable", async () => {
    mockParsePowerDetailsImage.mockResolvedValue({
      heroPowerTotal: null,
      breakdown: {
        heroLevel: 85_000_000,
        gear: 13_000_000,
      },
      complete: false,
    });

    const result = await handleWebThpCommand({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      locale: "en-US",
      screenshotBuffer: Buffer.from("fake-png"),
    });

    expect(result).toEqual({
      status: "ocr_partial",
      message: "thp.ocrPartial",
      partialBreakdown: {
        heroLevel: 85_000_000,
        gear: 13_000_000,
      },
    });
  });

  it("returns validation_error for manual invalid total (not screenshot)", async () => {
    const result = await handleWebThpCommand({
      allianceId: "alliance-1",
      hqUserId: "user-1",
      locale: "en-US",
      total: 2_000_000_000,
    });

    expect(result).toEqual({
      status: "validation_error",
      message: "thp.invalidTotal",
    });
    expect(mockParsePowerDetailsImage).not.toHaveBeenCalled();
  });
});
