import { describe, expect, it, vi } from "vitest";

import {
  allianceSelectionErrorStatus,
  listAccessibleAlliances,
  resolveConnectAlliance,
} from "@/lib/alliance/connect-alliance";
import * as fetchModule from "@/lib/base44/fetch";

const connection = {
  token: "t",
  appId: "app",
  originUrl: "https://ashed.online",
};

const LFgo = {
  id: "6a034217c66737ea6bef7187",
  tag: "LFgo",
  name: "Live Free Die Hard",
  owner_email: "erikhass54@gmail.com",
  collaborators: ["hubsub.llc@gmail.com"],
};

describe("listAccessibleAlliances", () => {
  it("filters alliances from Base44 list", async () => {
    vi.spyOn(fetchModule, "base44ListAlliances").mockResolvedValue([
      LFgo,
      {
        id: "other",
        tag: "Other",
        owner_email: "other@example.com",
      },
    ]);

    await expect(
      listAccessibleAlliances(connection, { email: "hubsub.llc@gmail.com" }),
    ).resolves.toEqual([
      {
        id: LFgo.id,
        tag: "LFgo",
        name: "Live Free Die Hard",
        accessRole: "maintainer",
      },
    ]);
  });
});

describe("resolveConnectAlliance", () => {
  it("auto-resolves a single accessible alliance", async () => {
    vi.spyOn(fetchModule, "base44ListAlliances").mockResolvedValue([LFgo]);

    await expect(
      resolveConnectAlliance(connection, { email: "hubsub.llc@gmail.com" }),
    ).resolves.toMatchObject({ tag: "LFgo", accessRole: "maintainer" });
  });

  it("requires allianceId when multiple are accessible", async () => {
    vi.spyOn(fetchModule, "base44ListAlliances").mockResolvedValue([
      LFgo,
      {
        id: "other",
        tag: "Other",
        collaborators: ["hubsub.llc@gmail.com"],
      },
    ]);

    await expect(
      resolveConnectAlliance(connection, { email: "hubsub.llc@gmail.com" }),
    ).rejects.toMatchObject({ code: "ambiguous" });
  });

  it("maps selection errors to HTTP statuses", () => {
    expect(allianceSelectionErrorStatus("none_accessible")).toBe(403);
    expect(allianceSelectionErrorStatus("ambiguous")).toBe(400);
    expect(allianceSelectionErrorStatus("not_accessible")).toBe(400);
  });
});
