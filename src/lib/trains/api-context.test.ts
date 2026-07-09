import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const getAllianceOperatingModeMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
}));

vi.mock("@/lib/native-alliance/operating-mode", () => ({
  getAllianceOperatingMode: (...args: unknown[]) =>
    getAllianceOperatingModeMock(...args),
}));

import { resolveTrainRequestContext } from "@/lib/trains/api-context";

describe("resolveTrainRequestContext", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns HQ-only context for native alliances", async () => {
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-native",
      allianceId: "hq-native",
      currentAllianceId: "hq-native",
    });
    getAllianceOperatingModeMock.mockResolvedValue("native");

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toEqual({
      sessionId: "sess-native",
      allianceId: "hq-native",
      operatingMode: "native",
    });
  });

  it("returns HQ-only context for ashed-mode alliances", async () => {
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-ashed",
      allianceId: "hq-ashed",
      currentAllianceId: "hq-ashed",
    });
    getAllianceOperatingModeMock.mockResolvedValue("ashed");

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toEqual({
      sessionId: "sess-ashed",
      allianceId: "hq-ashed",
      operatingMode: "ashed",
    });
  });

  it("returns 400 when no alliance is selected", async () => {
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-empty",
      allianceId: null,
      currentAllianceId: null,
    });

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toBeInstanceOf(NextResponse);
    expect((ctx as NextResponse).status).toBe(400);
  });
});
