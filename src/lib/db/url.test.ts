import { describe, expect, it, vi } from "vitest";

import {
  resolveDatabaseUrl,
  resolveListenDatabaseUrl,
  shouldPreferLocalDatabaseUrl,
  type DatabaseUrlEnv,
} from "./resolve-database-url";
import { resolveDatabaseUrl as resolveDatabaseUrlMjs } from "../../../scripts/lib/database-url.mjs";
import {
  getDatabaseUrl,
  getListenDatabaseUrl,
  normalizePostgresUrl,
  databaseHostFromUrl,
} from "./url";

const LOCAL =
  "postgresql://postgres:alliance-hq@localhost:5432/alliance_hq_dev";
const NEON =
  "postgresql://neondb_owner:secret@ep-orange-wildflower-adaa7e6k-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_UNPOOLED =
  "postgresql://neondb_owner:secret@ep-orange-wildflower-adaa7e6k.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_NON_POOLING =
  "postgresql://neondb_owner:secret@ep-orange-wildflower-adaa7e6k.c-2.us-east-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";

/** Mirrors a Vercel-pulled .env.development.local with both URLs set. */
const VERCEL_PULLED_LOCAL_DEV: DatabaseUrlEnv = {
  NODE_ENV: "development",
  VERCEL: "1",
  LOCAL_DATABASE_URL: LOCAL,
  DATABASE_URL: NEON,
};

const FIXTURES: Array<{
  name: string;
  env: DatabaseUrlEnv;
  expected: string;
  preferLocal: boolean;
}> = [
  {
    name: "next dev — LOCAL wins over Neon in DATABASE_URL",
    env: {
      NODE_ENV: "development",
      LOCAL_DATABASE_URL: LOCAL,
      DATABASE_URL: NEON,
    },
    expected: LOCAL,
    preferLocal: true,
  },
  {
    name: "vercel dev — LOCAL still wins (development on Vercel CLI)",
    env: VERCEL_PULLED_LOCAL_DEV,
    expected: LOCAL,
    preferLocal: true,
  },
  {
    name: "next start on laptop — LOCAL wins even though NODE_ENV=production",
    env: {
      NODE_ENV: "production",
      LOCAL_DATABASE_URL: LOCAL,
      DATABASE_URL: NEON,
    },
    expected: LOCAL,
    preferLocal: true,
  },
  {
    name: "Vercel production deploy — DATABASE_URL only",
    env: {
      NODE_ENV: "production",
      VERCEL: "1",
      LOCAL_DATABASE_URL: LOCAL,
      DATABASE_URL: NEON,
    },
    expected: NEON,
    preferLocal: false,
  },
  {
    name: "production without LOCAL — DATABASE_URL",
    env: {
      NODE_ENV: "production",
      VERCEL: "1",
      DATABASE_URL: NEON,
    },
    expected: NEON,
    preferLocal: false,
  },
  {
    name: "dev without LOCAL — falls back to DATABASE_URL",
    env: {
      NODE_ENV: "development",
      DATABASE_URL: NEON,
    },
    expected: NEON,
    preferLocal: false,
  },
  {
    name: "dev with only LOCAL",
    env: {
      NODE_ENV: "development",
      LOCAL_DATABASE_URL: LOCAL,
    },
    expected: LOCAL,
    preferLocal: true,
  },
  {
    name: "whitespace LOCAL is ignored — uses DATABASE_URL",
    env: {
      NODE_ENV: "development",
      LOCAL_DATABASE_URL: "   ",
      DATABASE_URL: NEON,
    },
    expected: NEON,
    preferLocal: false,
  },
];

describe("shouldPreferLocalDatabaseUrl", () => {
  it.each(FIXTURES)("$name", ({ env, preferLocal }) => {
    expect(shouldPreferLocalDatabaseUrl(env)).toBe(preferLocal);
  });
});

describe("resolveDatabaseUrl (TypeScript)", () => {
  it.each(FIXTURES)("$name", ({ env, expected }) => {
    expect(resolveDatabaseUrl(env)).toBe(expected);
  });

  it("throws when no URL is configured in development", () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: "development" })).toThrow(
      /LOCAL_DATABASE_URL|DATABASE_URL/,
    );
  });

  it("throws when DATABASE_URL missing on Vercel production", () => {
    expect(() =>
      resolveDatabaseUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        LOCAL_DATABASE_URL: LOCAL,
      }),
    ).toThrow(/DATABASE_URL is not set/);
  });
});

describe("resolveDatabaseUrl (scripts/lib/database-url.mjs)", () => {
  it.each(FIXTURES)("$name — mjs matches ts", ({ env, expected }) => {
    expect(resolveDatabaseUrlMjs(env)).toBe(expected);
    expect(resolveDatabaseUrlMjs(env)).toBe(resolveDatabaseUrl(env));
  });
});

describe("getDatabaseUrl", () => {
  it("reads from process.env via resolveDatabaseUrl", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("LOCAL_DATABASE_URL", LOCAL);
    vi.stubEnv("DATABASE_URL", NEON);
    try {
      expect(getDatabaseUrl()).toBe(LOCAL);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("resolveListenDatabaseUrl", () => {
  it("keeps LOCAL when local Postgres is preferred", () => {
    expect(
      resolveListenDatabaseUrl({
        NODE_ENV: "development",
        LOCAL_DATABASE_URL: LOCAL,
        DATABASE_URL: NEON,
        DATABASE_URL_UNPOOLED: NEON_UNPOOLED,
      }),
    ).toBe(LOCAL);
  });

  it("prefers DATABASE_URL_UNPOOLED on Vercel production", () => {
    expect(
      resolveListenDatabaseUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        LOCAL_DATABASE_URL: LOCAL,
        DATABASE_URL: NEON,
        DATABASE_URL_UNPOOLED: NEON_UNPOOLED,
      }),
    ).toBe(NEON_UNPOOLED);
  });

  it("falls back to POSTGRES_URL_NON_POOLING when UNPOOLED is unset", () => {
    expect(
      resolveListenDatabaseUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        DATABASE_URL: NEON,
        POSTGRES_URL_NON_POOLING: NEON_NON_POOLING,
      }),
    ).toBe(NEON_NON_POOLING);
  });

  it("falls back to the pooled DATABASE_URL when no direct URL is set", () => {
    expect(
      resolveListenDatabaseUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        DATABASE_URL: NEON,
      }),
    ).toBe(NEON);
  });

  it("uses unpooled when developing against Neon without LOCAL", () => {
    expect(
      resolveListenDatabaseUrl({
        NODE_ENV: "development",
        DATABASE_URL: NEON,
        DATABASE_URL_UNPOOLED: NEON_UNPOOLED,
      }),
    ).toBe(NEON_UNPOOLED);
  });
});

describe("getListenDatabaseUrl", () => {
  it("reads the unpooled URL from process.env", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("DATABASE_URL", NEON);
    vi.stubEnv("DATABASE_URL_UNPOOLED", NEON_UNPOOLED);
    try {
      expect(getListenDatabaseUrl()).toBe(NEON_UNPOOLED);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("databaseHostFromUrl", () => {
  it("returns hostname without credentials", () => {
    expect(
      databaseHostFromUrl(
        "postgresql://user:secret@ep-orange-wildflower-adaa7e6k-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toBe("ep-orange-wildflower-adaa7e6k-pooler.c-2.us-east-1.aws.neon.tech");
    expect(databaseHostFromUrl(LOCAL)).toBe("localhost");
  });
});

describe("normalizePostgresUrl", () => {
  it("strips Prisma-only schema query param", () => {
    expect(
      normalizePostgresUrl(
        "postgresql://localhost/db?schema=public&sslmode=require",
      ),
    ).toBe("postgresql://localhost/db?sslmode=require");
  });
});

describe("regression: never hit Neon when LOCAL is set locally", () => {
  it("old rule (NODE_ENV-only) would wrongly pick Neon on next start — fixed", () => {
    const env: DatabaseUrlEnv = {
      NODE_ENV: "production",
      LOCAL_DATABASE_URL: LOCAL,
      DATABASE_URL: NEON,
    };
    // Previous logic: !isProduction && local → false, so DATABASE_URL won
    expect(env.NODE_ENV).toBe("production");
    expect(resolveDatabaseUrl(env)).toBe(LOCAL);
  });

  it("localhost host is chosen for typical laptop dev envs", () => {
    const localOnlyEnvs: DatabaseUrlEnv[] = [
      {
        NODE_ENV: "development",
        LOCAL_DATABASE_URL: LOCAL,
        DATABASE_URL: NEON,
      },
      VERCEL_PULLED_LOCAL_DEV,
      {
        NODE_ENV: "production",
        LOCAL_DATABASE_URL: LOCAL,
        DATABASE_URL: NEON,
      },
    ];

    for (const env of localOnlyEnvs) {
      const url = new URL(resolveDatabaseUrl(env));
      expect(url.hostname, JSON.stringify(env)).toBe("localhost");
    }
  });

  it("Neon host is chosen only on Vercel production", () => {
    const url = new URL(
      resolveDatabaseUrl({
        NODE_ENV: "production",
        VERCEL: "1",
        LOCAL_DATABASE_URL: LOCAL,
        DATABASE_URL: NEON,
      }),
    );
    expect(url.hostname).toContain("neon.tech");
  });
});
