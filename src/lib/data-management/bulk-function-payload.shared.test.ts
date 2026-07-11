import { describe, expect, it } from "vitest";

import {
  buildBulkDeletePayload,
  buildBulkMovePayload,
} from "./bulk-function-payload.shared";

describe("bulk function payloads", () => {
  it("builds delete payload with optional context fields", () => {
    expect(
      buildBulkDeletePayload({
        submitEntity: "DesertStormScore",
        recordedDate: "2026-05-29",
        allianceId: "alliance-1",
        contextJson: {
          eventId: "event-1",
          team: "A",
          boardKey: "board-1",
        },
      }),
    ).toEqual({
      entity: "DesertStormScore",
      recorded_date: "2026-05-29",
      alliance_id: "alliance-1",
      event_id: "event-1",
      team: "A",
      board_key: "board-1",
    });
  });

  it("omits empty optional context fields from delete payload", () => {
    expect(
      buildBulkDeletePayload({
        submitEntity: "KillScore",
        recordedDate: "2026-06-01",
        allianceId: "alliance-2",
        contextJson: {},
      }),
    ).toEqual({
      entity: "KillScore",
      recorded_date: "2026-06-01",
      alliance_id: "alliance-2",
    });
  });

  it("extends delete payload with new_recorded_date for move", () => {
    expect(
      buildBulkMovePayload({
        submitEntity: "DesertStormScore",
        recordedDate: "2026-05-29",
        newRecordedDate: "2026-05-30",
        allianceId: "alliance-1",
        contextJson: { eventId: "event-1", team: "B" },
      }),
    ).toEqual({
      entity: "DesertStormScore",
      recorded_date: "2026-05-29",
      alliance_id: "alliance-1",
      event_id: "event-1",
      team: "B",
      new_recorded_date: "2026-05-30",
    });
  });
});
