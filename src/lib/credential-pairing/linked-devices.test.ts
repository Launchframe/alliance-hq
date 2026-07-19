import { beforeEach, describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const onConflictDoUpdate = vi.fn();
const returning = vi.fn();

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return {
          onConflictDoUpdate: (...conflictArgs: unknown[]) => {
            onConflictDoUpdate(...conflictArgs);
            return {
              returning: (...retArgs: unknown[]) => {
                returning(...retArgs);
                return Promise.resolve([{ id: "existing-device" }]);
              },
            };
          },
        };
      },
    }),
  }),
  schema: {
    linkedDevices: {
      sessionId: "linked_devices.session_id",
      id: "linked_devices.id",
    },
  },
}));

vi.mock("@/lib/credential-pairing/user-agent", () => ({
  truncateUserAgent: (value: string | null | undefined) => value ?? null,
  parseOsLabelFromUserAgent: () => "Android 10",
  defaultLinkedDeviceName: (os: string | null) => os ?? "Mobile device",
}));

describe("registerLinkedDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts on session_id so re-linking the same browser succeeds", async () => {
    const { registerLinkedDevice } = await import("./linked-devices");

    const id = await registerLinkedDevice({
      hqUserId: "hq-1",
      sessionId: "mobile-sess",
      pairingCodeId: "pair-1",
      userAgent: "Mozilla/5.0 Android",
    });

    expect(id).toBe("existing-device");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        hqUserId: "hq-1",
        sessionId: "mobile-sess",
        pairingCodeId: "pair-1",
        deviceName: "Android 10",
        osLabel: "Android 10",
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "linked_devices.session_id",
        set: expect.objectContaining({
          hqUserId: "hq-1",
          pairingCodeId: "pair-1",
          revokedAt: null,
        }),
      }),
    );
  });
});
