import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerEmail = vi.hoisted(() => ({
  resolveAllianceOwnerEmail: vi.fn().mockResolvedValue("owner@example.com"),
  sendRosterLinkOwnerApprovalEmail: vi.fn().mockResolvedValue(undefined),
}));

const opsAlerts = vi.hoisted(() => ({
  claimOpsAlertFingerprint: vi.fn().mockResolvedValue(true),
  releaseOpsAlertFingerprint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ops/platform-maintainer-alert.server", () => opsAlerts);

vi.mock("./roster-link-inbox.server", () => ({
  satisfyRosterLinkInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./roster-link-owner-email.server", () => ownerEmail);

describe("runRosterLinkReminderPass", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("E2E_TEST", "");
  });

  it("claims dedupe fingerprint only after preflight checks", async () => {
    ownerEmail.resolveAllianceOwnerEmail.mockResolvedValue(null);

    const tokenRows = [
      { action: "accept", expiresAt: new Date(Date.now() + 86400000) },
      { action: "reject", expiresAt: new Date(Date.now() + 86400000) },
    ];
    const pendingRequests = [
      {
        id: "req-1",
        allianceId: "a1",
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        gameUserName: "Commander",
        reportedName: "Commander",
        gameUid: "1234567890121203",
        gameServerNumber: 1203,
      },
    ];

    let fromTable: unknown;
    const makeChain = (result: unknown) => {
      const chain = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
      chain.from.mockImplementation((table: unknown) => {
        fromTable = table;
        return chain;
      });
      chain.where.mockReturnValue(chain);
      chain.limit.mockResolvedValue(result);
      chain.where.mockImplementation(() => {
        if (fromTable === schemaTables.hqRosterLinkActionTokens) {
          return Promise.resolve(tokenRows);
        }
        if (fromTable === schemaTables.alliances) {
          return Promise.resolve([{ tag: "LFgo" }]);
        }
        return Promise.resolve(pendingRequests);
      });
      return chain;
    };

    const schemaTables = {
      hqRosterLinkRequests: Symbol("requests"),
      hqRosterLinkActionTokens: Symbol("tokens"),
      alliances: Symbol("alliances"),
      inboxReminderItems: Symbol("inbox"),
    };

    vi.doMock("@/lib/db", () => ({
      getDb: () => ({
        select: vi.fn(() => makeChain(pendingRequests)),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
          })),
        })),
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      }),
      schema: schemaTables,
    }));

    const { runRosterLinkReminderPass } = await import(
      "./roster-link-reminders.server"
    );
    const sent = await runRosterLinkReminderPass();
    expect(sent).toBe(0);
    expect(opsAlerts.claimOpsAlertFingerprint).not.toHaveBeenCalled();
  });
});
