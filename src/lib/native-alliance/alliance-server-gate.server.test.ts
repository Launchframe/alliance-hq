import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAllianceGameServerNumber } from "@/lib/game-season/game-servers.server";

import {
  AllianceServerRequiredError,
  assertAllianceLinkedGameServer,
} from "./alliance-server-gate.server";

vi.mock("@/lib/game-season/game-servers.server", () => ({
  resolveAllianceGameServerNumber: vi.fn(),
}));

describe("assertAllianceLinkedGameServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws AllianceServerRequiredError when server is not linked", async () => {
    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(null);

    await expect(assertAllianceLinkedGameServer("alliance-1")).rejects.toBeInstanceOf(
      AllianceServerRequiredError,
    );
  });

  it("resolves when server is linked", async () => {
    vi.mocked(resolveAllianceGameServerNumber).mockResolvedValue(1203);

    await expect(assertAllianceLinkedGameServer("alliance-1")).resolves.toBeUndefined();
  });
});
