import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  alliance: { operatingMode: "ashed", ashedAllianceId: "remote-alliance" },
  credential: vi.fn(), token: "test-token",
}));
vi.mock("@/lib/db", async () => ({ schema: await import("@/lib/db/schema"), getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: () => [mocked.alliance] }) }) }) }) }));
vi.mock("@/lib/vr/repository", () => ({ getAllianceAshedCredential: mocked.credential }));
vi.mock("@/lib/crypto/encrypt", () => ({ decryptSecret: () => mocked.token }));

import { createExcusedRecord, deleteExcusedRecord, fetchExcusedRecord, fetchExcusedSnapshot, resolveExcusedConnection, validateExcusedMember } from "./excused-transport.server";
import { excusedFingerprint } from "./excused-actions.server";
import { parseExcusedSnapshot, type DesiredExcusedRecord } from "./excused-sync.shared";

const fetchMock = vi.fn();
const context = { allianceId: "remote-alliance", appId: "test-app", connection: { appId: "test-app", token: "test-token", originUrl: "https://ashed.online" } };
const wire = { id: "remote-period", alliance_id: "remote-alliance", member_id: "member-a", record_type: "vs", start_date: "2026-09-10", end_date: "2026-09-12", reason: "Time off recorded in Alliance HQ.", updated_date: "2026-09-01T12:00:00.000Z" };
const desired: DesiredExcusedRecord = { allianceId: context.allianceId, memberId: "member-a", recordType: "vs", startDate: wire.start_date, endDate: wire.end_date, reason: wire.reason };

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mocked.alliance = { operatingMode: "ashed", ashedAllianceId: "remote-alliance" };
  mocked.token = "test-token";
  mocked.credential.mockResolvedValue({ encryptedToken: "cipher", tokenExpiresAt: new Date(Date.now() + 60_000), appId: "test-app", originUrl: "https://ashed.online" });
});
afterEach(() => vi.unstubAllGlobals());

describe("scoped ExcusedRecord transport", () => {
  it("continues after a short page and advances by actual returned rows", async () => {
    fetchMock.mockResolvedValueOnce(Response.json([wire])).mockResolvedValueOnce(Response.json([{ ...wire, id: "second" }])).mockResolvedValueOnce(Response.json([]));
    expect(await fetchExcusedSnapshot(context)).toHaveLength(2);
    expect(fetchMock.mock.calls.map((call) => new URL(call[0]).searchParams.get("skip"))).toEqual(["0", "1", "2"]);
  });

  it("rejects ignored pagination, malformed lists and outages rather than returning empty", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(Response.json([wire])));
    await expect(fetchExcusedSnapshot(context)).rejects.toMatchObject({ code: "invalid_snapshot" });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "PRIVATE_UPSTREAM_DETAIL" }, { status: 503 }));
    await expect(fetchExcusedSnapshot(context)).rejects.toMatchObject({ code: "failed" });
    fetchMock.mockResolvedValueOnce(Response.json({ items: [] }));
    await expect(fetchExcusedSnapshot(context)).rejects.toMatchObject({ code: "invalid_snapshot" });
  });

  it("returns missing only for a scoped 404 and rejects wrong member or tenant", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchExcusedRecord(context, wire.id, "member-a")).toBeNull();
    fetchMock.mockResolvedValueOnce(Response.json({ ...wire, member_id: "member-b" }));
    await expect(fetchExcusedRecord(context, wire.id, "member-a")).rejects.toMatchObject({ code: "conflict" });
    fetchMock.mockResolvedValueOnce(Response.json({ ...wire, alliance_id: "other" }));
    await expect(fetchExcusedRecord(context, wire.id, "member-a")).rejects.toMatchObject({ code: "invalid_snapshot" });
  });

  it("verifies actual upstream member tenancy before a create can be dispatched", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: "member-a", alliance_id: context.allianceId }));
    await expect(validateExcusedMember(context, "member-a")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(Response.json({ id: "member-a", alliance_id: "other-alliance" }));
    await expect(validateExcusedMember(context, "member-a")).rejects.toMatchObject({ code: "conflict" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(validateExcusedMember(context, "missing")).rejects.toMatchObject({ code: "conflict" });
    expect(fetchMock.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
  });

  it("posts only the intended scope, dates and generic reason", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: "created" }));
    const input = { ...desired, notes: "PRIVATE_HQ_NOTE" };
    expect(await createExcusedRecord(context, input)).toBe("created");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ alliance_id: "remote-alliance", member_id: "member-a", record_type: "vs", start_date: wire.start_date, end_date: wire.end_date, reason: wire.reason });
    expect(JSON.stringify(body)).not.toContain("PRIVATE_HQ_NOTE");
  });

  it("classifies POST timeouts, malformed success and server errors as unknown outcomes", async () => {
    fetchMock.mockRejectedValueOnce(new Error("PRIVATE_UPSTREAM_DETAIL"));
    await expect(createExcusedRecord(context, desired)).rejects.toMatchObject({ code: "uncertain", message: "uncertain" });
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await expect(createExcusedRecord(context, desired)).rejects.toMatchObject({ code: "uncertain" });
    fetchMock.mockResolvedValueOnce(Response.json({ error: "PRIVATE_UPSTREAM_DETAIL" }, { status: 500 }));
    await expect(createExcusedRecord(context, desired)).rejects.toMatchObject({ code: "uncertain", message: "uncertain" });
  });

  it("distinguishes definitive credential denial and idempotent delete-not-found", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(createExcusedRecord(context, desired)).rejects.toMatchObject({ code: "credentials_required" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(deleteExcusedRecord(context, "already-gone")).resolves.toBeUndefined();
  });

  it("uses canonical fingerprints independent of JSON object ordering", () => {
    const record = parseExcusedSnapshot([wire], context.allianceId)[0];
    const reordered = Object.fromEntries(Object.entries(record).reverse()) as typeof record;
    expect(excusedFingerprint(record)).toBe(excusedFingerprint(reordered));
    expect(excusedFingerprint({ ...record, endDate: "2026-09-13" })).not.toBe(excusedFingerprint(record));
  });
});

describe("alliance credential binding", () => {
  it("does not perform Ashed I/O for native alliances or expired credentials", async () => {
    mocked.alliance.operatingMode = "native";
    expect(await resolveExcusedConnection("hq-alliance")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    mocked.alliance.operatingMode = "ashed";
    mocked.credential.mockResolvedValueOnce({ tokenExpiresAt: new Date(0) });
    await expect(resolveExcusedConnection("hq-alliance")).rejects.toMatchObject({ code: "credentials_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies the credential holder against the exact target alliance", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: "owner", email: "owner@e2e.test" }))
      .mockResolvedValueOnce(Response.json({ id: "remote-alliance", tag: "TEST", owner_id: "owner" }));
    expect(await resolveExcusedConnection("hq-alliance")).toMatchObject({ allianceId: "remote-alliance", appId: "test-app" });
    fetchMock.mockResolvedValueOnce(Response.json({ id: "outsider", email: "outsider@e2e.test" }))
      .mockResolvedValueOnce(Response.json({ id: "remote-alliance", tag: "TEST", owner_id: "owner", collaborators: [] }));
    await expect(resolveExcusedConnection("hq-alliance")).rejects.toMatchObject({ code: "credentials_required" });
  });
});
