import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  forUpdate: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  transaction: vi.fn(),
  ensureBankAtCoords: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: mocks.transaction,
  }),
  schema: {
    battlePlanCaptureEvents: {
      id: "id",
      allianceId: "allianceId",
      status: "status",
      bankId: "bankId",
      territoryType: "territoryType",
      gameServerNumber: "gameServerNumber",
      coordX: "coordX",
      coordY: "coordY",
      level: "level",
      capturePolicy: "capturePolicy",
      scheduledAt: "scheduledAt",
    },
    banks: {
      id: "id",
      allianceId: "allianceId",
    },
  },
}));

vi.mock("@/lib/banks/repository.server", () => ({
  ensureBankAtCoords: (...args: unknown[]) =>
    mocks.ensureBankAtCoords(...args),
}));

vi.mock("@/lib/banks/api.shared", () => ({
  validateBankPayload: () => null,
}));

import {
  ConfirmCaptureError,
  confirmStrongholdCaptureCreatesBank,
} from "@/lib/battle-plan/confirm-capture.server";

const scheduledEvent = {
  id: "evt-1",
  allianceId: "ally-1",
  territoryType: "stronghold",
  status: "scheduled",
  bankId: null,
  gameServerNumber: 123,
  coordX: 10,
  coordY: 20,
  level: 5,
  capturePolicy: "peace",
  scheduledAt: new Date("2026-09-01T12:00:00.000Z"),
};

const bankRow = {
  id: "bank-1",
  allianceId: "ally-1",
  gameServerNumber: 123,
  coordX: 10,
  coordY: 20,
  level: 5,
};

function limitChain(forRows: unknown[], plainRows?: unknown[]) {
  return {
    for: () => Promise.resolve(forRows),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(plainRows ?? []).then(resolve, reject),
  };
}

describe("confirmStrongholdCaptureCreatesBank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (fn) => {
      const tx = {
        select: mocks.select,
        update: mocks.update,
      };
      return fn(tx);
    });
    mocks.select.mockReturnValue({ from: mocks.from });
    mocks.from.mockReturnValue({ where: mocks.where });
    mocks.where.mockReturnValue({ limit: mocks.limit });
    mocks.update.mockReturnValue({ set: mocks.updateSet });
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
  });

  it("rejects when a concurrent cancel wins before link", async () => {
    mocks.limit.mockReturnValueOnce(
      limitChain([{ ...scheduledEvent, status: "cancelled" }]),
    );

    await expect(
      confirmStrongholdCaptureCreatesBank({
        allianceId: "ally-1",
        eventId: "evt-1",
      }),
    ).rejects.toMatchObject({
      name: "ConfirmCaptureError",
      code: "CANCELLED",
    });
    expect(mocks.ensureBankAtCoords).not.toHaveBeenCalled();
  });

  it("returns existing bank when event is already linked", async () => {
    mocks.limit
      .mockReturnValueOnce(
        limitChain([
          { ...scheduledEvent, status: "completed", bankId: "bank-1" },
        ]),
      )
      // Bank-by-id select awaits `.limit(1)` directly (no for update).
      .mockReturnValueOnce(limitChain([], [bankRow]));

    const bank = await confirmStrongholdCaptureCreatesBank({
      allianceId: "ally-1",
      eventId: "evt-1",
    });

    expect(bank).toEqual(bankRow);
    expect(mocks.ensureBankAtCoords).not.toHaveBeenCalled();
  });

  it("creates/links bank under FOR UPDATE and CAS status", async () => {
    mocks.limit.mockReturnValueOnce(limitChain([scheduledEvent]));
    mocks.ensureBankAtCoords.mockResolvedValueOnce(bankRow);
    mocks.updateReturning.mockResolvedValueOnce([
      { id: "evt-1", status: "completed", bankId: "bank-1" },
    ]);

    const bank = await confirmStrongholdCaptureCreatesBank({
      allianceId: "ally-1",
      eventId: "evt-1",
    });

    expect(bank).toEqual(bankRow);
    expect(mocks.ensureBankAtCoords).toHaveBeenCalledOnce();
    expect(mocks.updateReturning).toHaveBeenCalledOnce();
  });

  it("surfaces CAS miss as cancelled", async () => {
    mocks.limit.mockReturnValueOnce(limitChain([scheduledEvent]));
    mocks.ensureBankAtCoords.mockResolvedValueOnce(bankRow);
    mocks.updateReturning.mockResolvedValueOnce([]);

    await expect(
      confirmStrongholdCaptureCreatesBank({
        allianceId: "ally-1",
        eventId: "evt-1",
      }),
    ).rejects.toBeInstanceOf(ConfirmCaptureError);
  });

  it("fills missing coords from confirm payload before bank create", async () => {
    const noCoords = {
      ...scheduledEvent,
      gameServerNumber: null,
      coordX: null,
      coordY: null,
      level: null,
    };
    mocks.limit.mockReturnValueOnce(limitChain([noCoords]));
    mocks.updateWhere.mockResolvedValueOnce(undefined);
    mocks.ensureBankAtCoords.mockResolvedValueOnce(bankRow);
    mocks.updateReturning.mockResolvedValueOnce([
      { id: "evt-1", status: "completed", bankId: "bank-1" },
    ]);

    const bank = await confirmStrongholdCaptureCreatesBank({
      allianceId: "ally-1",
      eventId: "evt-1",
      coords: {
        gameServerNumber: 742,
        coordX: 100,
        coordY: 200,
        level: 5,
      },
    });

    expect(bank).toEqual(bankRow);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        gameServerNumber: 742,
        coordX: 100,
        coordY: 200,
        level: 5,
        updatedAt: expect.any(Date),
      }),
    );
    expect(mocks.ensureBankAtCoords).toHaveBeenCalledOnce();
  });
});
