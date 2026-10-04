import { readFileSync } from "node:fs";

import nextEnv from "@next/env";
import { describe, expect, it } from "vitest";

import { createE2eRuntimeEnv, E2E_DIST_DIR } from "./e2e-runtime.mjs";
import { resolveDatabaseUrl } from "./lib/database-url.mjs";

const { processEnv } = nextEnv;

const E2E_URL = "postgresql://e2e:e2e@127.0.0.1:5432/alliance_hq_e2e";
const PROD_URL = "postgresql://prod:prod@db.example.com/alliance_hq_prod";

function source(overrides = {}) {
  return {
    PATH: "/usr/bin",
    HOME: "/tmp/e2e-home",
    E2E_DATABASE_URL: E2E_URL,
    ...overrides,
  };
}

function readSource(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("createE2eRuntimeEnv", () => {
  it("refuses when no database URL is supplied", () => {
    expect(() => createE2eRuntimeEnv({})).toThrow(
      "Set E2E_DATABASE_URL to a dedicated e2e database.",
    );
  });

  it("never accepts DATABASE_URL as the database source", () => {
    expect(() =>
      createE2eRuntimeEnv(
        source({ E2E_DATABASE_URL: undefined, DATABASE_URL: E2E_URL }),
      ),
    ).toThrow("Set E2E_DATABASE_URL to a dedicated e2e database.");
  });

  it("refuses a non-e2e database name even when DATABASE_URL is valid", () => {
    expect(() =>
      createE2eRuntimeEnv(
        source({
          E2E_DATABASE_URL: undefined,
          LOCAL_DATABASE_URL: PROD_URL,
          DATABASE_URL: E2E_URL,
        }),
      ),
    ).toThrow(/Refusing to run e2e against a non-e2e database/);
  });

  it("replaces a stale LOCAL_DATABASE_URL with E2E_DATABASE_URL everywhere", () => {
    const env = createE2eRuntimeEnv(
      source({ LOCAL_DATABASE_URL: PROD_URL }),
    );
    expect(env.E2E_DATABASE_URL).toBe(E2E_URL);
    expect(env.LOCAL_DATABASE_URL).toBe(E2E_URL);
    expect(env.DATABASE_URL).toBe(E2E_URL);
    expect(resolveDatabaseUrl(env)).toBe(E2E_URL);
  });

  it("does not propagate caller keys, secrets, or NODE_OPTIONS", () => {
    const env = createE2eRuntimeEnv(
      source({
        TOKEN_ENCRYPTION_KEY: "b".repeat(64),
        AUTH_SECRET: "real-auth-secret-with-plenty-of-length",
        NODE_OPTIONS: "--inspect-brk --require ./preload.js",
        RESEND_API_KEY: "live-resend-key",
        STRIPE_SECRET: "sk_live_something",
      }),
    );
    expect(env.TOKEN_ENCRYPTION_KEY).toBe("a".repeat(64));
    expect(env.AUTH_SECRET).toBe("e2e-test-auth-secret-min-32-characters");
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=8192");
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.STRIPE_SECRET).toBeUndefined();
    expect(Object.keys(env)).not.toContain("RESEND_API_KEY");
  });

  it("sets the dummy identity and isolation flags for fixture parity", () => {
    const env = createE2eRuntimeEnv(source());
    expect(env.TOKEN_ENCRYPTION_KEY).toBe("a".repeat(64));
    expect(env.AUTH_SECRET).toBe("e2e-test-auth-secret-min-32-characters");
    expect(env.E2E_EMAIL_CODE).toBe("424242");
    expect(env.E2E_TEST).toBe("true");
    expect(env.HQ_E2E_ISOLATED).toBe("1");
    expect(env.__NEXT_PROCESSED_ENV).toBe("true");
    expect(env.NODE_ENV).toBe("production");
  });

  it("freezes loopback origins on the isolated port", () => {
    const env = createE2eRuntimeEnv(source());
    expect(env.PLAYWRIGHT_E2E_PORT).toBe("5176");
    expect(env.PLAYWRIGHT_BASE_URL).toBe("http://localhost:5176");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:5176");
    expect(env.CALENDAR_APP_ORIGIN).toBe("http://localhost:5176");
    expect(env.OCR_WORKER_BASE_URL).toBe("http://127.0.0.1:5176");
    expect(env.ASHED_API_BASE_ORIGIN).toBe("http://127.0.0.1:14789");

    const custom = createE2eRuntimeEnv(
      source({ PLAYWRIGHT_E2E_PORT: "6200" }),
    );
    expect(custom.NEXT_PUBLIC_APP_URL).toBe("http://localhost:6200");
    expect(custom.OCR_WORKER_BASE_URL).toBe("http://127.0.0.1:6200");
  });

  it.each(["http://localhost:5176", "http://127.0.0.1:5176"])(
    "accepts PLAYWRIGHT_BASE_URL %p on the isolated port",
    (baseUrl) => {
      const env = createE2eRuntimeEnv(
        source({ PLAYWRIGHT_BASE_URL: baseUrl }),
      );
      expect(env.PLAYWRIGHT_BASE_URL).toBe(baseUrl);
      expect(env.NEXT_PUBLIC_APP_URL).toBe(baseUrl);
      expect(env.CALENDAR_APP_ORIGIN).toBe(baseUrl);
    },
  );

  it("treats an empty PLAYWRIGHT_BASE_URL as unset", () => {
    const env = createE2eRuntimeEnv(
      source({ PLAYWRIGHT_BASE_URL: "   " }),
    );
    expect(env.PLAYWRIGHT_BASE_URL).toBe("http://localhost:5176");
  });

  it("honors PLAYWRIGHT_BASE_URL on a custom isolated port", () => {
    const env = createE2eRuntimeEnv(
      source({
        PLAYWRIGHT_E2E_PORT: "6200",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:6200",
      }),
    );
    expect(env.PLAYWRIGHT_BASE_URL).toBe("http://127.0.0.1:6200");
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:6200");
    expect(env.OCR_WORKER_BASE_URL).toBe("http://127.0.0.1:6200");
  });

  it.each([
    "https://staging.example.com",
    "http://localhost:6200",
    "http://localhost:5176/path",
    "http://localhost:5176?query=1",
    "https://localhost:5176",
    "http://127.0.0.2:5176",
  ])("rejects PLAYWRIGHT_BASE_URL %p", (baseUrl) => {
    expect(() =>
      createE2eRuntimeEnv(source({ PLAYWRIGHT_BASE_URL: baseUrl })),
    ).toThrow(
      "PLAYWRIGHT_BASE_URL must match the isolated loopback server.",
    );
  });

  it.each(["abc", "80", "1023", "65536", "12 34"])(
    "rejects invalid port %p",
    (port) => {
      expect(() =>
        createE2eRuntimeEnv(source({ PLAYWRIGHT_E2E_PORT: port })),
      ).toThrow("Invalid isolated E2E port.");
    },
  );

  it.each([
    "https://followup.example.com/hook",
    "http://203.0.113.10:8080/hook",
    "http://user:pw@127.0.0.1:5177/hook",
    "https://localhost:5177/hook",
    "not-a-url",
  ])("rejects non-loopback followup origin %p", (origin) => {
    expect(() =>
      createE2eRuntimeEnv(
        source({ E2E_DISCORD_FOLLOWUP_ORIGIN: origin }),
      ),
    ).toThrow("E2E_DISCORD_FOLLOWUP_ORIGIN must be a loopback http URL.");
  });

  it.each([
    "http://localhost:5177",
    "http://127.0.0.1:5177/hook",
    "http://[::1]:5177",
  ])("accepts loopback followup origin %p", (origin) => {
    const env = createE2eRuntimeEnv(
      source({ E2E_DISCORD_FOLLOWUP_ORIGIN: origin }),
    );
    expect(env.E2E_DISCORD_FOLLOWUP_ORIGIN).toBe(origin);
  });

  it("rejects a non-mock OCR provider", () => {
    expect(() =>
      createE2eRuntimeEnv(source({ VIDEO_OCR_PROVIDER: "anthropic" })),
    ).toThrow("Isolated E2E OCR provider must be mock or local.");
  });

  it.each(["mock", "local"])(
    "accepts OCR provider %p and enables nonprod",
    (provider) => {
      const env = createE2eRuntimeEnv(
        source({ VIDEO_OCR_PROVIDER: provider }),
      );
      expect(env.VIDEO_OCR_PROVIDER).toBe(provider);
      expect(env.VIDEO_OCR_ALLOW_NONPROD).toBe("true");
    },
  );

  it("omits provider and signature keys when not supplied", () => {
    const env = createE2eRuntimeEnv(source());
    expect(env.VIDEO_OCR_PROVIDER).toBeUndefined();
    expect(env.VIDEO_OCR_ALLOW_NONPROD).toBeUndefined();
    expect(env.DISCORD_PUBLIC_KEY).toBeUndefined();
    expect(env.E2E_DISCORD_FOLLOWUP_ORIGIN).toBeUndefined();
  });

  it("passes through a supplied DISCORD_PUBLIC_KEY", () => {
    const env = createE2eRuntimeEnv(
      source({ DISCORD_PUBLIC_KEY: "a".repeat(64) }),
    );
    expect(env.DISCORD_PUBLIC_KEY).toBe("a".repeat(64));
  });
});

describe("@next/env __NEXT_PROCESSED_ENV contract", () => {
  it("skips loaded env-file records when the flag is set", () => {
    const records = [
      {
        path: ".env.local",
        contents: "ISOLATION_PROBE=must-not-load\n",
        env: {},
      },
    ];
    const hadFlag = process.env.__NEXT_PROCESSED_ENV;
    process.env.__NEXT_PROCESSED_ENV = "true";
    try {
      processEnv(records, process.cwd());
      expect(process.env.ISOLATION_PROBE).toBeUndefined();

      delete process.env.__NEXT_PROCESSED_ENV;
      processEnv(
        [
          {
            path: ".env.local",
            contents: "ISOLATION_PROBE_TWO=must-load\n",
            env: {},
          },
        ],
        process.cwd(),
      );
      expect(process.env.ISOLATION_PROBE_TWO).toBe("must-load");
    } finally {
      delete process.env.ISOLATION_PROBE;
      delete process.env.ISOLATION_PROBE_TWO;
      if (hadFlag === undefined) {
        delete process.env.__NEXT_PROCESSED_ENV;
      } else {
        process.env.__NEXT_PROCESSED_ENV = hadFlag;
      }
    }
  });
});

describe("isolated harness source contract", () => {
  it("runs the isolated entry point from playwright config", () => {
    const config = readSource("playwright.config.ts");
    expect(config).toContain("node scripts/e2e-server-isolated.mjs");
    expect(config).not.toContain("node scripts/e2e-server.mjs");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).not.toContain("reuseExistingServer: !");
    expect(config).toContain("global-teardown-isolated");
    expect(config).toContain("createE2eRuntimeEnv");
  });

  it("propagates the runtime env to workers for fixture parity", () => {
    const config = readSource("playwright.config.ts").replace(/\s+/g, " ");
    for (const key of [
      "DATABASE_URL",
      "LOCAL_DATABASE_URL",
      "E2E_DATABASE_URL",
      "TOKEN_ENCRYPTION_KEY",
      "AUTH_SECRET",
      "E2E_TEST",
      "HQ_E2E_ISOLATED",
      "__NEXT_PROCESSED_ENV",
      "E2E_EMAIL_CODE",
      "PLAYWRIGHT_BASE_URL",
      "NOTES_INTAKE_TEST_PROVIDER",
      "NOTES_HISTORY_TEST_PROVIDER",
      "NOTES_KNOWLEDGE_TEST_PROVIDER",
    ]) {
      expect(config).toContain(`process.env.${key} = runtimeEnv.${key}`);
    }
    expect(config).toContain(
      "const baseURL = runtimeEnv.PLAYWRIGHT_BASE_URL",
    );
  });

  it("keeps spawned children in the runner-owned process group", () => {
    const entry = readSource("scripts/e2e-server-isolated.mjs");
    expect(entry).toContain("detached: false");
    expect(entry).toContain("killImpl(child.pid");
    expect(entry).not.toContain("killImpl(-");
    expect(entry).toContain('"SIGKILL"');
    expect(entry).toContain("import.meta.url");
    expect(entry).toContain("runIsolatedE2eServer");
  });

  it("keeps the new runtime free of filesystem and dotenv access", () => {
    for (const file of [
      "scripts/e2e-runtime.mjs",
      "scripts/e2e-server-isolated.mjs",
    ]) {
      const source = readSource(file);
      expect(source).not.toContain("node:fs");
      expect(source).not.toContain("readFileSync");
      expect(source).not.toContain("writeFileSync");
      expect(source).not.toContain("rmSync");
      expect(source).not.toContain("rm -rf");
      expect(source).not.toContain("prepareEnvFile");
      expect(source).not.toContain("backupEnvFile");
      expect(source).not.toContain("restoreEnvFile");
      expect(source).not.toContain("dotenv");
      expect(source).not.toContain("loadEnv");
      expect(source).not.toContain(".env.local");
    }
  });

  it("does not delete the development build directory", () => {
    const runtime = readSource("scripts/e2e-runtime.mjs");
    const server = readSource("scripts/e2e-server-isolated.mjs");
    expect(runtime).toContain(E2E_DIST_DIR);
    for (const source of [runtime, server]) {
      expect(source).not.toMatch(/(?<![\w-])\.next(?!-e2e)/);
    }
  });

  it("routes the build into the isolated dist directory", () => {
    const nextConfig = readSource("next.config.ts");
    expect(nextConfig).toContain('distDir: ".next-e2e"');
    expect(nextConfig).toContain("tsconfig.e2e-build.json");
    expect(nextConfig).toContain("HQ_E2E_ISOLATED");
    expect(nextConfig).toContain("E2E_TEST");
  });

  it("restores a legacy env file from isolated teardown", () => {
    const teardown = readSource("e2e/global-teardown-isolated.ts");
    expect(teardown).toContain("restoreEnvFile");
    expect(teardown).toContain("closeE2eSql");
    const server = readSource("scripts/e2e-server-isolated.mjs");
    expect(server).not.toContain("restoreEnvFile");
  });

  it("guards dotenv loading in db maintenance scripts", () => {
    for (const file of [
      "scripts/db-migrate.mjs",
      "scripts/rbac/seed.mjs",
      "scripts/commendations/seed.mjs",
      "scripts/trains/seed-rule-templates.mjs",
    ]) {
      const source = readSource(file);
      expect(source).toContain('HQ_E2E_ISOLATED !== "1"');
      expect(source).toContain("assertE2eDatabaseUrl");
    }
  });
});
