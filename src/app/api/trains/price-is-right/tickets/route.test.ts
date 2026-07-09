import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";

vi.mock("@/lib/session", () => ({
  getOrCreateSession: vi.fn().mockResolvedValue({ id: "sess-1", hqUserId: "hq-1" }),
}));

vi.mock("@/lib/rbac/require-permission", () => ({
  requireSessionPermission: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/trains/api-context", () => ({
  resolveTrainRequestContext: vi.fn(),
}));

describe("price-is-right tickets GET", () => {
  it("400s without date", async () => {
    const { resolveTrainRequestContext } = await import(
      "@/lib/trains/api-context"
    );
    vi.mocked(resolveTrainRequestContext).mockResolvedValue({
      sessionId: "sess-1",
      allianceId: "ally-1",
      ashedAllianceId: "ashed-1",
      connection: null,
      operatingMode: "native",
    });

    const res = await GET(
      new Request("http://localhost/api/trains/price-is-right/tickets"),
    );
    expect(res.status).toBe(400);
  });
});
