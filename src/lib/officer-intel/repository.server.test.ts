import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPutObject = vi.fn();
const mockDeleteObject = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/storage", () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

vi.mock("@/lib/officer-intel/locale-text.server", () => ({
  resolveOfficerChatLocaleText: vi.fn(async () => ({
    localeText: "localized text",
    localeCode: "en-US",
    translationUnavailable: false,
  })),
}));

let nanoidCounter = 0;
vi.mock("nanoid", () => ({
  nanoid: () => `generated-${nanoidCounter++}`,
}));

const mockState = vi.hoisted(() => ({
  sessionRow: null as Record<string, unknown> | null,
  previousImages: [] as Array<Record<string, unknown>>,
}));

const mockTransaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => {
  function makeSelectChain() {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = async () => (mockState.sessionRow ? [mockState.sessionRow] : []);
    chain.orderBy = async () => mockState.previousImages;
    return chain;
  }
  return {
    getDb: () => ({
      select: () => makeSelectChain(),
      transaction: mockTransaction,
    }),
    schema: {
      officerChatSessions: { id: "s.id", allianceId: "s.allianceId" },
      officerChatMessages: {
        sessionId: "m.sessionId",
        allianceId: "m.allianceId",
        sequenceOrder: "m.sequenceOrder",
      },
      officerChatSessionImages: {
        sessionId: "i.sessionId",
        allianceId: "i.allianceId",
        sequenceOrder: "i.sequenceOrder",
      },
    },
  };
});

import { importOfficerChatSession } from "@/lib/officer-intel/repository.server";

function makeTx() {
  return {
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
  };
}

const OLD_IMAGE_KEY = "officer-intel/alliance-1/session-1/old-image.png";

const baseInput = {
  sessionId: "session-1",
  allianceId: "alliance-1",
  hqLocale: "en-US",
  messages: [
    {
      senderName: "Alpha",
      originalText: "Hello",
      sequenceOrder: 0,
      sourceImageIndex: 0,
    },
  ],
  images: [{ buffer: Buffer.from("new-image"), mimeType: "image/png" }],
};

beforeEach(() => {
  nanoidCounter = 0;
  mockPutObject.mockReset().mockResolvedValue(undefined);
  mockDeleteObject.mockReset().mockResolvedValue(undefined);
  mockTransaction.mockReset();
  mockState.sessionRow = {
    id: "session-1",
    allianceId: "alliance-1",
    title: "Original title",
    channelLabel: null,
    sessionAt: null,
    status: "draft",
  };
  mockState.previousImages = [
    {
      id: "old-image",
      sessionId: "session-1",
      allianceId: "alliance-1",
      storageKey: OLD_IMAGE_KEY,
      sequenceOrder: 0,
    },
  ];
});

describe("importOfficerChatSession", () => {
  it("returns an error when the session does not belong to the alliance", async () => {
    mockState.sessionRow = null;

    const result = await importOfficerChatSession(baseInput);

    expect(result).toEqual({ error: "Session not found." });
    expect(mockPutObject).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("uploads new images and commits before deleting superseded R2 objects", async () => {
    const tx = makeTx();
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      await fn(tx);
    });

    const result = await importOfficerChatSession(baseInput);

    expect(result).toEqual({ ok: true });
    expect(mockPutObject).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(2);
    expect(tx.insert).toHaveBeenCalledTimes(2);
    expect(tx.update).toHaveBeenCalledTimes(1);

    // Old R2 objects are only removed after the DB transaction commits.
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(OLD_IMAGE_KEY);
  });

  it("cleans up newly uploaded R2 objects and preserves prior data when the DB transaction fails", async () => {
    mockTransaction.mockImplementation(async () => {
      throw new Error("insert failed");
    });

    await expect(importOfficerChatSession(baseInput)).rejects.toThrow(
      "insert failed",
    );

    expect(mockPutObject).toHaveBeenCalledTimes(1);
    const uploadedKey = mockPutObject.mock.calls[0]?.[0] as string;

    // Only the just-uploaded object is cleaned up; the still-valid prior
    // image (whose DB rows were never touched thanks to the rolled-back
    // transaction) must not be deleted.
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith(uploadedKey);
    expect(mockDeleteObject).not.toHaveBeenCalledWith(OLD_IMAGE_KEY);
  });

  it("does not touch the transaction or storage cleanup when the R2 upload itself fails", async () => {
    mockPutObject.mockRejectedValueOnce(new Error("R2 unavailable"));

    await expect(importOfficerChatSession(baseInput)).rejects.toThrow(
      "R2 unavailable",
    );

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });
});
