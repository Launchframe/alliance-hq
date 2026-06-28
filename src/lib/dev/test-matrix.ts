/**
 * Dev/preview test-account matrix — single source of truth.
 *
 * Maintainers extend this when a new system role or user-level capacity ships;
 * the registry derives roles from `ROLE_IDS`, so adding a role to the RBAC
 * catalog automatically widens the matrix. Both the seed script
 * (`scripts/dev/seed-test-matrix.ts`) and the quick-switch route
 * (`src/app/api/dev/test-matrix/switch/route.ts`) read from here so seeded
 * accounts and switch targets never drift.
 *
 * Client-safe: emails, labels, and stable ids only — no secrets, no `game_uid`.
 */
import { ROLE_IDS, type SystemRoleName } from "@/lib/rbac/constants";

export type TestMatrixMode = "ashed" | "native";
export type TestMatrixAllianceKey = "ashed" | "native";

export type TestMatrixAllianceSpec = {
  key: TestMatrixAllianceKey;
  /** Default in-game tag; the ashed alliance tag can be overridden at seed time. */
  defaultTag: string;
  name: string;
  /** Stable fake Last War server number for schema paths that require one. */
  gameServerNumber: number;
  mode: TestMatrixMode;
};

/** Two tenants so the shell can be observed in both operating modes. */
export const TEST_MATRIX_ALLIANCES: readonly TestMatrixAllianceSpec[] = [
  {
    key: "ashed",
    defaultTag: "TMASH",
    name: "Test Matrix (Ashed mode)",
    gameServerNumber: 9901,
    mode: "ashed",
  },
  {
    key: "native",
    defaultTag: "TMNAT",
    name: "Test Matrix (Native mode)",
    gameServerNumber: 9902,
    mode: "native",
  },
];

/** Derived from the RBAC catalog so the matrix auto-extends with new roles. */
export const TEST_MATRIX_ROLES = Object.keys(ROLE_IDS) as SystemRoleName[];

export const TEST_MATRIX_EMAIL_DOMAIN = "frontline.gay";
export const TEST_MATRIX_EMAIL_PREFIX = "test-matrix";

export type TestMatrixAccount = {
  email: string;
  displayName: string;
  allianceKey: TestMatrixAllianceKey;
  /** Default tag for the account's alliance (display + seed default). */
  allianceTag: string;
  mode: TestMatrixMode;
  /** Membership role; `null` for the platform-maintainer-only account. */
  role: SystemRoleName | null;
  /** When true the switch route attaches a fake session Ashed credential. */
  ashed: boolean;
  platformMaintainer: boolean;
  /**
   * Stable Ashed identity id when `ashed` is true. The seed writes this to
   * `hq_users.ashed_user_id` and the switch route stores a matching credential
   * so `sessionHoldsAshedIdentityForHqUser` keeps the fake credential bound.
   */
  ashedUserId: string | null;
};

function allianceByKey(key: TestMatrixAllianceKey): TestMatrixAllianceSpec {
  const spec = TEST_MATRIX_ALLIANCES.find((a) => a.key === key);
  if (!spec) {
    throw new Error(`Unknown test-matrix alliance key: ${key}`);
  }
  return spec;
}

function ashedSuffix(ashed: boolean): string {
  return ashed ? "ashed" : "noashed";
}

/**
 * Deterministic account email. Uses the alliance's **default** tag (not a
 * seed-time override) so identities stay stable when `--tag` changes only the
 * alliance row's display tag.
 */
export function testMatrixEmail(input: {
  allianceKey: TestMatrixAllianceKey;
  role: SystemRoleName;
  ashed: boolean;
}): string {
  const tag = allianceByKey(input.allianceKey).defaultTag.toLowerCase();
  return `${TEST_MATRIX_EMAIL_PREFIX}+${tag}-${input.role}-${ashedSuffix(
    input.ashed,
  )}@${TEST_MATRIX_EMAIL_DOMAIN}`;
}

export const TEST_MATRIX_PLATFORM_MAINTAINER_EMAIL = `${TEST_MATRIX_EMAIL_PREFIX}+platform-maintainer@${TEST_MATRIX_EMAIL_DOMAIN}`;

function testMatrixDisplayName(input: {
  allianceTag: string;
  role: SystemRoleName;
  ashed: boolean;
}): string {
  return `${input.allianceTag} ${input.role} ${input.ashed ? "+Ashed" : "noAshed"}`;
}

function testMatrixAshedUserId(email: string): string {
  return `test-matrix-ashed:${email}`;
}

/**
 * Full account matrix: every alliance × every role × {ashed, no-ashed}, plus a
 * single platform-maintainer account anchored to the ashed-mode alliance.
 */
export function buildTestMatrixAccounts(): TestMatrixAccount[] {
  const accounts: TestMatrixAccount[] = [];

  for (const alliance of TEST_MATRIX_ALLIANCES) {
    for (const role of TEST_MATRIX_ROLES) {
      for (const ashed of [false, true]) {
        const email = testMatrixEmail({
          allianceKey: alliance.key,
          role,
          ashed,
        });
        accounts.push({
          email,
          displayName: testMatrixDisplayName({
            allianceTag: alliance.defaultTag,
            role,
            ashed,
          }),
          allianceKey: alliance.key,
          allianceTag: alliance.defaultTag,
          mode: alliance.mode,
          role,
          ashed,
          platformMaintainer: false,
          ashedUserId: ashed ? testMatrixAshedUserId(email) : null,
        });
      }
    }
  }

  const ashedAlliance = allianceByKey("ashed");
  accounts.push({
    email: TEST_MATRIX_PLATFORM_MAINTAINER_EMAIL,
    displayName: "Platform maintainer",
    allianceKey: ashedAlliance.key,
    allianceTag: ashedAlliance.defaultTag,
    mode: ashedAlliance.mode,
    role: null,
    ashed: false,
    platformMaintainer: true,
    ashedUserId: null,
  });

  return accounts;
}

export function findTestMatrixAccount(email: string): TestMatrixAccount | null {
  const normalized = email.trim().toLowerCase();
  return (
    buildTestMatrixAccounts().find(
      (account) => account.email.toLowerCase() === normalized,
    ) ?? null
  );
}
