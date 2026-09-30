import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/ops/platform-maintainer-alert.server", () => ({
  emailPlatformMaintainers: vi.fn().mockResolvedValue({ sent: true, recipientCount: 1 }),
}));

import { emailPlatformMaintainers } from "@/lib/ops/platform-maintainer-alert.server";
import { notifyLastWarUidLookupOutage } from "@/lib/lastwar/lookup-outage-alert.server";

describe("notifyLastWarUidLookupOutage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it("emails maintainers with an hourly dedupe fingerprint and no UID", async () => {
    const now = new Date("2026-03-29T15:42:00.000Z");
    const result = await notifyLastWarUidLookupOutage({
      detail: "HTTP 500 from accounts CDN",
      now,
    });

    expect(result).toEqual({ sent: true });
    expect(emailPlatformMaintainers).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "[Alliance HQ] Last War UID lookup failing (preview)",
        dedupeFingerprint: "lastwar-uid-lookup-outage:preview:2026-03-29T15",
        text: expect.stringContaining("HTTP 500 from accounts CDN"),
      }),
    );
    const call = vi.mocked(emailPlatformMaintainers).mock.calls[0]?.[0];
    expect(call?.text).not.toMatch(/\d{12,16}/);
  });
});
