import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getOrCreateSessionMock = vi.fn();
const getAshedConnectionMock = vi.fn();
const getAllianceOperatingModeMock = vi.fn();
const loadAllianceRowMock = vi.fn();
const resolveAllianceByTagMock = vi.fn();

vi.mock("@/lib/session", () => ({
  getOrCreateSession: () => getOrCreateSessionMock(),
  getAshedConnection: (...args: unknown[]) => getAshedConnectionMock(...args),
}));

vi.mock("@/lib/native-alliance/operating-mode", () => ({
  getAllianceOperatingMode: (...args: unknown[]) =>
    getAllianceOperatingModeMock(...args),
}));

vi.mock("@/lib/members/game-roster", () => ({
  loadAllianceRow: (...args: unknown[]) => loadAllianceRowMock(...args),
}));

vi.mock("@/lib/alliance/resolve", () => ({
  resolveAllianceByTag: (...args: unknown[]) =>
    resolveAllianceByTagMock(...args),
}));

import { resolveTrainRequestContext } from "@/lib/trains/api-context";

describe("resolveTrainRequestContext", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns native context without Ashed connection", async () => {
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-native",
      allianceId: "hq-native",
      currentAllianceId: "hq-native",
      allianceTag: null,
    });
    getAllianceOperatingModeMock.mockResolvedValue("native");
    loadAllianceRowMock.mockResolvedValue({ tag: "NATV" });

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toEqual({
      sessionId: "sess-native",
      allianceId: "hq-native",
      ashedAllianceId: "hq-native",
      connection: null,
      operatingMode: "native",
    });
    expect(getAshedConnectionMock).not.toHaveBeenCalled();
  });

  it("allows ashed alliance schedule ops without user Ashed connection", async () => {
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-ashed",
      allianceId: "hq-ashed",
      currentAllianceId: "hq-ashed",
      allianceTag: "LFgo",
    });
    getAllianceOperatingModeMock.mockResolvedValue("ashed");
    loadAllianceRowMock.mockResolvedValue({
      tag: "LFgo",
      ashedAllianceId: "ashed-entity-123",
    });
    getAshedConnectionMock.mockResolvedValue(null);

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toEqual({
      sessionId: "sess-ashed",
      allianceId: "hq-ashed",
      ashedAllianceId: "ashed-entity-123",
      connection: null,
      operatingMode: "ashed",
    });
    expect(resolveAllianceByTagMock).not.toHaveBeenCalled();
  });

  it("falls back to HQ alliance id when ashed id is unknown and user is disconnected", async () => {
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-ashed",
      allianceId: "hq-ashed",
      currentAllianceId: "hq-ashed",
      allianceTag: null,
    });
    getAllianceOperatingModeMock.mockResolvedValue("ashed");
    loadAllianceRowMock.mockResolvedValue({ tag: "LFgo", ashedAllianceId: null });
    getAshedConnectionMock.mockResolvedValue(null);

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toEqual({
      sessionId: "sess-ashed",
      allianceId: "hq-ashed",
      ashedAllianceId: "hq-ashed",
      connection: null,
      operatingMode: "ashed",
    });
  });

  it("resolves ashed alliance id live when connected and row is missing", async () => {
    const connection = { apiKey: "key", baseUrl: "https://example.test" };
    getOrCreateSessionMock.mockResolvedValue({
      id: "sess-ashed",
      allianceId: "hq-ashed",
      currentAllianceId: "hq-ashed",
      allianceTag: "LFgo",
    });
    getAllianceOperatingModeMock.mockResolvedValue("ashed");
    loadAllianceRowMock.mockResolvedValue({ tag: "LFgo", ashedAllianceId: null });
    getAshedConnectionMock.mockResolvedValue(connection);
    resolveAllianceByTagMock.mockResolvedValue({ id: "live-ashed-id" });

    const ctx = await resolveTrainRequestContext();

    expect(ctx).toEqual({
      sessionId: "sess-ashed",
      allianceId: "hq-ashed",
      ashedAllianceId: "live-ashed-id",
      connection,
      operatingMode: "ashed",
    });
    expect(resolveAllianceByTagMock).toHaveBeenCalledWith(connection, "LFgo");
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
