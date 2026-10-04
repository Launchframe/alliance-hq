import { describe, expect, it } from "vitest";

import {
  canUnlockLockedConductor,
  trainOwnerUnlockWindowOpen,
} from "@/lib/trains/train-ownership.shared";

describe("trainOwnerUnlockWindowOpen", () => {
  it("keeps a current-day lock open until midnight Server Time", () => {
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-17",
        today: "2026-08-17",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("closes a current-day lock after midnight Server Time", () => {
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-17",
        today: "2026-08-18",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("keeps a future-day lock open through that train day", () => {
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-21",
        today: "2026-08-17",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-21",
        today: "2026-08-21",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("closes a future-day lock after midnight of that train day", () => {
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-21",
        today: "2026-08-22",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("lets the owner undo a past-day lock at any time", () => {
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-10",
        today: "2026-08-17",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      trainOwnerUnlockWindowOpen({
        trainDate: "2026-08-10",
        today: "2026-08-20",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("canUnlockLockedConductor", () => {
  it("allows unlimited unlock regardless of locker or window", () => {
    expect(
      canUnlockLockedConductor({
        unlimitedUnlock: true,
        actorHqUserId: "other",
        lockedByHqUserId: "locker",
        trainDate: "2026-08-10",
        today: "2026-08-18",
        lockedAt: "2026-08-10T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("allows the locking officer while the window is open", () => {
    expect(
      canUnlockLockedConductor({
        unlimitedUnlock: false,
        actorHqUserId: "locker",
        lockedByHqUserId: "locker",
        trainDate: "2026-08-17",
        today: "2026-08-17",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("rejects a different officer even while the window is open", () => {
    expect(
      canUnlockLockedConductor({
        unlimitedUnlock: false,
        actorHqUserId: "other",
        lockedByHqUserId: "locker",
        trainDate: "2026-08-17",
        today: "2026-08-17",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("rejects the locking officer after midnight of a current/future train day", () => {
    expect(
      canUnlockLockedConductor({
        unlimitedUnlock: false,
        actorHqUserId: "locker",
        lockedByHqUserId: "locker",
        trainDate: "2026-08-17",
        today: "2026-08-18",
        lockedAt: "2026-08-17T12:00:00.000Z",
      }),
    ).toBe(false);
  });
});
