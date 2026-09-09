import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ASHED_CONNECTION_STATUS_TEST_ID,
  OPEN_ASHED_CONNECTION_EVENT,
  requestOpenAshedConnection,
} from "./open-ashed-connection.shared";

describe("requestOpenAshedConnection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when the header chip is missing", () => {
    expect(requestOpenAshedConnection()).toBe(false);
  });

  it("dispatches the open event when the header chip is present", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === `[data-testid="${ASHED_CONNECTION_STATUS_TEST_ID}"]`
          ? {}
          : null,
    });
    vi.stubGlobal("window", { dispatchEvent });

    expect(requestOpenAshedConnection()).toBe(true);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0]?.[0] as Event;
    expect(event.type).toBe(OPEN_ASHED_CONNECTION_EVENT);
  });
});
