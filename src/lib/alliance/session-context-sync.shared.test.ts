import { describe, expect, it } from "vitest";

import {
  parseAllianceSessionContextPayload,
} from "./session-context-sync.shared";

describe("parseAllianceSessionContextPayload", () => {
  it("parses valid payload", () => {
    expect(
      parseAllianceSessionContextPayload(
        JSON.stringify({ allianceId: "a1", at: 1000 }),
      ),
    ).toEqual({ allianceId: "a1", at: 1000 });
  });

  it("rejects invalid payloads", () => {
    expect(parseAllianceSessionContextPayload(null)).toBeNull();
    expect(parseAllianceSessionContextPayload("")).toBeNull();
    expect(parseAllianceSessionContextPayload("{bad")).toBeNull();
    expect(
      parseAllianceSessionContextPayload(JSON.stringify({ allianceId: "" })),
    ).toBeNull();
  });
});
