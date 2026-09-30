import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({ on: vi.fn(), kill: vi.fn() })),
  writeFileSync: vi.fn(),
  backupEnvFile: vi.fn(),
  restoreEnvFile: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execSync: mocks.execSync, spawn: mocks.spawn }));
vi.mock("node:fs", () => ({ default: { writeFileSync: mocks.writeFileSync } }));
vi.mock("dotenv", () => ({ config: vi.fn() }));
vi.mock("./e2e-env-file.mjs", () => ({ AUTOGEN_MARKER: "test-generated-env", ENV_LOCAL: ".env.local", backupEnvFile: mocks.backupEnvFile, restoreEnvFile: mocks.restoreEnvFile }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("forces the legacy build and start into the same isolated environment", async () => {
  vi.stubEnv("E2E_DATABASE_URL", "postgresql://e2e:e2e@127.0.0.1:5432/alliance_hq_e2e");
  vi.stubEnv("AUTH_SECRET", "e2e-test-auth-secret-min-32-characters");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("HQ_E2E_ISOLATED", "0");
  vi.stubEnv("__NEXT_PROCESSED_ENV", "");
  vi.spyOn(process, "on").mockReturnValue(process);
  await import("./e2e-server.mjs");
  expect(mocks.execSync).toHaveBeenCalledTimes(1);
  expect(mocks.execSync.mock.calls[0][0]).toBe("npm run build");
  const buildEnv = mocks.execSync.mock.calls[0][1].env;
  expect(buildEnv.HQ_E2E_ISOLATED).toBe("1");
  expect(buildEnv.__NEXT_PROCESSED_ENV).toBe("true");
  expect(buildEnv.E2E_TEST).toBe("true");
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  expect(mocks.spawn.mock.calls[0][1]).toContain("start");
  expect(mocks.spawn.mock.calls[0][2].env === buildEnv).toBe(true);
});
