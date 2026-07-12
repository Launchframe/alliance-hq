import { beforeEach, describe, expect, it, vi } from "vitest";

const base44Json = vi.hoisted(() => vi.fn());
const base44EntityPost = vi.hoisted(() => vi.fn());
const base44CallFunction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/base44/fetch", () => ({
  base44Json,
  base44EntityPost,
  base44CallFunction,
}));

import {
  replaceAshedScoresForContext,
  resolveOrCreateAshedEvent,
} from "./ashed-event-provision.server";

const connection = {
  token: "t",
  originUrl: "https://example.com",
  appId: "app",
} as const;

describe("resolveOrCreateAshedEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an existing event when date matches", async () => {
    base44Json.mockResolvedValueOnce([
      { id: "ev-existing", event_date: "2026-07-10" },
    ]);

    await expect(
      resolveOrCreateAshedEvent({
        connection: connection as never,
        eventEntity: "DesertStormEvent",
        ashedAllianceId: "ashed-1",
        recordedDate: "2026-07-10",
      }),
    ).resolves.toEqual({ eventId: "ev-existing", created: false });
    expect(base44EntityPost).not.toHaveBeenCalled();
  });

  it("falls back to alliance-wide list then creates when missing", async () => {
    base44Json
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "other", event_date: "2026-07-01" }]);
    base44EntityPost.mockResolvedValueOnce({ id: "ev-new" });

    await expect(
      resolveOrCreateAshedEvent({
        connection: connection as never,
        eventEntity: "DesertStormEvent",
        ashedAllianceId: "ashed-1",
        recordedDate: "2026-07-10",
      }),
    ).resolves.toEqual({ eventId: "ev-new", created: true });
    expect(base44EntityPost).toHaveBeenCalledWith(
      connection,
      "DesertStormEvent",
      { alliance_id: "ashed-1", event_date: "2026-07-10" },
    );
  });
});

describe("replaceAshedScoresForContext", () => {
  it("calls bulkDeleteByDate with event and team context", async () => {
    base44CallFunction.mockResolvedValueOnce({});
    await replaceAshedScoresForContext({
      connection: connection as never,
      target: {
        submitEntity: "DesertStormScore",
      } as never,
      ashedAllianceId: "ashed-1",
      recordedDate: "2026-07-10",
      context: { eventId: "ev-1", team: "A" },
    });
    expect(base44CallFunction).toHaveBeenCalledWith(
      connection,
      "bulkDeleteByDate",
      {
        entity: "DesertStormScore",
        recorded_date: "2026-07-10",
        alliance_id: "ashed-1",
        event_id: "ev-1",
        team: "A",
      },
    );
  });
});
