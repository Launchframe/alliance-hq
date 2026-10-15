import { beforeEach, describe, expect, it, vi } from "vitest";

const lockWorker = vi.fn();
const events: string[] = [];

function chainSelect(rows: unknown[]) {
  const thenable = {
    limit: () => thenable,
    for: async () => rows,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return {
    from: () => ({
      where: () => thenable,
    }),
  };
}

vi.mock("./control-policy.server", () => ({
  lockWorker: (...args: unknown[]) => lockWorker(...args),
  workerHash: vi.fn(),
  workerUsage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      events.push("tx");
      const tx = {
        select: () => {
          const call = events.filter((e) => e === "select").length;
          events.push("select");
          if (call === 0) {
            return chainSelect([{ allianceId: "alliance-a" }]);
          }
          return chainSelect([
            {
              id: "job-1",
              allianceId: "alliance-a",
              state: "running",
              leaseToken: "tok-old",
              leaseExpiresAt: new Date(0),
              expiresAt: new Date(Date.now() + 86_400_000),
              attempts: 1,
            },
          ]);
        },
        update: () => {
          events.push("update");
          return {
            set: () => ({
              where: async () => {
                events.push("update-where");
                return [];
              },
            }),
          };
        },
      };
      return fn(tx);
    },
  }),
  schema: {
    ocrWorkerJobs: {
      id: "id",
      allianceId: "alliance_id",
      leaseToken: "lease_token",
      state: "state",
    },
    ocrWorkerAttempts: {
      jobId: "job_id",
      attempt: "attempt",
    },
  },
}));

describe("failWorkerJob lease fence", () => {
  beforeEach(() => {
    events.length = 0;
    lockWorker.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("rejects expired lease without marking the job failed (reclaimable)", async () => {
    const { failWorkerJob } = await import("./control-leases.server");
    await expect(failWorkerJob("job-1", "tok-old", "worker_crashed")).rejects.toMatchObject({
      code: "stale_worker_lease",
    });
    expect(events).toEqual(["tx", "select", "select"]);
    expect(events).not.toContain("update");
  });
});
