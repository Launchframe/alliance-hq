import { describe, expect, it } from "vitest";
import {
  donationLaunchErrorMessageKey,
  isBrowserDocumentNavigation,
} from "./store-launch-navigation.shared";

function navRequest(headers: Record<string, string>, method = "GET"): Request {
  return new Request("https://hq.example/api/launch", { method, headers });
}

describe("isBrowserDocumentNavigation", () => {
  it("accepts top-level document navigation", () => {
    expect(
      isBrowserDocumentNavigation(
        navRequest({
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        }),
      ),
    ).toBe(true);
  });

  it("rejects HEAD", () => {
    expect(
      isBrowserDocumentNavigation(
        navRequest(
          { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
          "HEAD",
        ),
      ),
    ).toBe(false);
  });

  it("rejects fetch/cors without navigate mode", () => {
    expect(
      isBrowserDocumentNavigation(
        navRequest({ "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }),
      ),
    ).toBe(false);
  });

  it("rejects requests with no Sec-Fetch headers", () => {
    expect(isBrowserDocumentNavigation(navRequest({}))).toBe(false);
  });
});

describe("donationLaunchErrorMessageKey", () => {
  it("maps known codes to i18n keys", () => {
    expect(donationLaunchErrorMessageKey("recipient_uid_unavailable")).toBe(
      "donationUnavailable",
    );
    expect(donationLaunchErrorMessageKey("donation_store_unavailable")).toBe(
      "donationStoreUnavailable",
    );
    expect(donationLaunchErrorMessageKey("forbidden")).toBe(
      "donationLaunchFailed",
    );
  });
});
