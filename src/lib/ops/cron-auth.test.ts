// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { authorizeCron, bearerMatches } from "./cron-auth";

describe("bearerMatches", () => {
  it("accepts exact Bearer secret", () => {
    expect(bearerMatches("s3cret", "Bearer s3cret")).toBe(true);
  });

  it("rejects wrong or missing auth", () => {
    expect(bearerMatches("s3cret", "Bearer other")).toBe(false);
    expect(bearerMatches("s3cret", null)).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
  });
});

describe("authorizeCron", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.VIDEO_WORKER_SECRET;
  });

  it("accepts CRON_SECRET and alternate env keys", () => {
    process.env.CRON_SECRET = "cron-secret";
    process.env.VIDEO_WORKER_SECRET = "worker-secret";
    const cronReq = new Request("http://localhost", {
      headers: { authorization: "Bearer cron-secret" },
    });
    const workerReq = new Request("http://localhost", {
      headers: { authorization: "Bearer worker-secret" },
    });
    expect(authorizeCron(cronReq)).toBe(true);
    expect(
      authorizeCron(workerReq, { alternateEnvKeys: ["VIDEO_WORKER_SECRET"] }),
    ).toBe(true);
    expect(authorizeCron(workerReq)).toBe(false);
  });

  it("fails closed when no secrets are configured", () => {
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer anything" },
    });
    expect(authorizeCron(req)).toBe(false);
  });
});
