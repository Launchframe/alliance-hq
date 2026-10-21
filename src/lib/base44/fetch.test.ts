import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

import { base44ListMemberRecords } from "@/lib/base44/fetch";

const connection = {
  token: "test-token",
  appId: "app-1",
  originUrl: "https://example.test",
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

describe("base44ListMemberRecords", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("keeps same-alliance and untyped rows, drops foreign alliance_id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "a", current_name: "Alpha", alliance_id: "alliance-1" },
        { id: "b", current_name: "Beta" },
        { id: "c", current_name: "Charlie", alliance_id: "alliance-2" },
      ]),
    );

    const rows = await base44ListMemberRecords(connection, "alliance-1");
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("refuses a non-empty Member list that omits alliance_id on every row", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "a", current_name: "Alpha" },
        { id: "b", current_name: "Beta" },
      ]),
    );

    await expect(
      base44ListMemberRecords(connection, "alliance-1"),
    ).rejects.toThrow(/omitted alliance_id/i);
  });

  it("returns an empty list without error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await expect(
      base44ListMemberRecords(connection, "alliance-1"),
    ).resolves.toEqual([]);
  });

  it("returns empty when every row explicitly belongs to another alliance", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { id: "x", current_name: "X", alliance_id: "alliance-2" },
        { id: "y", current_name: "Y", alliance_id: "alliance-3" },
      ]),
    );

    const rows = await base44ListMemberRecords(connection, "alliance-1");
    expect(rows).toEqual([]);
  });
});
