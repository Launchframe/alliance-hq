import { describe, expect, it } from "vitest";

import {
  buildBulkDeletePayload,
  buildBulkMovePayload,
} from "./bulk-function-payload.shared";

describe("bulk function payloads", () => {
  it("builds delete payload with Ashed field names and optional context", () => {
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
      alliance_id: "alliance-1",
      entity_type: "DesertStormScore",
      recorded_date: "2026-05-29",
      confirm: true,
      event_id: "event-1",
      team: "A",
      board_key: "board-1",
    });
  });

  it("omits empty optional context fields from delete payload", () => {
    expect(
      buildBulkDeletePayload({
        submitEntity: "VSScore",
        recordedDate: "2026-06-01",
        allianceId: "alliance-2",
        contextJson: {},
      }),
    ).toEqual({
      alliance_id: "alliance-2",
      entity_type: "VSScore",
      recorded_date: "2026-06-01",
      confirm: true,
    });
  });

  it("builds move payload with from_date / to_date", () => {
    expect(
      buildBulkMovePayload({
        submitEntity: "DesertStormScore",
        recordedDate: "2026-05-29",
        newRecordedDate: "2026-05-30",
        allianceId: "alliance-1",
        contextJson: { eventId: "event-1", team: "B" },
      }),
    ).toEqual({
      alliance_id: "alliance-1",
      entity_type: "DesertStormScore",
      from_date: "2026-05-29",
      to_date: "2026-05-30",
      event_id: "event-1",
      team: "B",
    });
  });
});
