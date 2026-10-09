/**
 * Fetch LastRank alliance page and match/sync into HQ.
 *
 * See `printHelp()` / `--help` for flags and first-pass `--create-all` usage.
 */
import { createRequire } from "node:module";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config } from "dotenv";

import { databaseHostFromUrl, resolveDatabaseUrl } from "@/lib/db/url";
import {
  buildInteractiveHqChoices,
  resolveInteractiveHqNameAnswer,
} from "@/lib/lastrank/alliance-page.shared";
import {
  assertCliDatabaseHostConfirmed,
  isLocalDatabaseHost,
} from "@/lib/lastrank/cli-database-guard.shared";
import { resolveLastRankSyncCliTarget } from "@/lib/lastrank/sync-registry.shared";
import {
  formatLastRankSyncPlanStats,
  lastRankSyncPlanQueuedCount,
  type LastRankSyncPlanListener,
  type LastRankSyncPlanStats,
} from "@/lib/lastrank/sync-plan.shared";
import type { LastRankInteractivePrompt } from "@/lib/lastrank/sync-alliance.server";

const require = createRequire(import.meta.url);
require("./register-server-only.cjs");

config({ path: ".env.local", quiet: true });
config({ quiet: true });

function printHelp(): void {
  console.log(`Usage:
  npx tsx scripts/lastrank/sync-alliance.ts --server <n> --tag <tag> [flags]
  npx tsx scripts/lastrank/sync-alliance.ts --id <lastrankAllianceId> [flags]
  npm run lastrank:sync -- --server <n> --tag <tag> [flags]

Target (required — one of):
  --server <number>   Game server number (with --tag)
  --tag <tag>         Alliance tag on that server (with --server)
  --id <hex>          LastRank alliance id (32-char hex, from lastrank.fun/a/<id>)

  Any alliance works. --server + --tag alone needs a LASTRANK_SYNC_REGISTRY entry;
  otherwise pass --id --server --tag. Explicit --server/--tag override the registry.

  Env fallbacks: LASTRANK_SYNC_SERVER + LASTRANK_SYNC_TAG, or LASTRANK_ALLIANCE_ID

Flags:
  --apply             Write matches (stats, ranks, profile) and create/retire when flagged
  --create-all        With --apply: create every unmatched ranked LastRank member (Ashed+HQ when linked)
                      Ambiguous and unranked (leaver) rows are skipped. Requires --apply.
  --retire-all        With --apply: mark every excess HQ active (not on LastRank) as former
                      (Ashed status + HQ). Requires --apply.
  --interactive       TTY prompts: map unmatched names, pick fuzzy alliance, retire leavers
                      Prints LastRank profile URL; unranked rows hint leavers (blank = skip).
                      Name prompt: number = HQ choice, C = create one member, blank = skip
                      Mapping always saves lastrank_public_id; --apply also renames HQ/Ashed.
                      Suggestions rank by name + THP and country (profession breaks ties).
                      Answers are queued and written in one batch after the last prompt;
                      Ctrl+C before then discards them (asks twice).
  --ashed-connection-key <key>
                      Upsert alliance bot Ashed credential (with --apply, or with
                      --save-ashed-credential on dry-run). Never logged.
                      Env: LASTRANK_ASHED_CONNECTION_KEY
  --save-ashed-credential
                      Persist --ashed-connection-key even without --apply
  --hq-only           Never dual-write to Ashed (HQ DB only). Use on Neon clones.
  --confirm-host <host>
                      Required to write (--apply, --interactive, --save-ashed-credential)
                      to a non-localhost database; must equal the host printed at startup.
  -h, --help          Show this help and exit

Database: same resolution as the app — LOCAL_DATABASE_URL wins when set, else
DATABASE_URL. Every run prints the resolved host first. For production:
  LOCAL_DATABASE_URL= DATABASE_URL='<prod url>' npx tsx scripts/lastrank/sync-alliance.ts \\
    ... --apply --confirm-host <prod host>

Every run prints a roster diff (excess HQ / missing from HQ / ambiguous) before writes.
--apply alone never creates members: use --create-all (new/empty alliance) or --interactive.

Examples:
  # Dry-run: see excess leavers and missing joins
  npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo

  # Fix transfer overshoot + missing joins (Ashed dual-write when bot JWT present)
  npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo \\
    --ashed-connection-key "$ASHED_CONNECTION_KEY" \\
    --apply --create-all --retire-all

  # Interactive map + write
  npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo --apply --interactive

Docs: docs/guides/lastrank-alliance-sync.md`);
}

function wantsHelp(): boolean {
  return (
    process.argv.includes("--help") ||
    process.argv.includes("-h") ||
    process.argv.includes("help")
  );
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function argInt(flag: string): number | undefined {
  const raw = arg(flag);
  if (raw == null) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function createTtyPrompts(): {
  interactivePrompt: LastRankInteractivePrompt;
  alliancePrompt: (ctx: {
    target: { gameServerNumber: number; tag: string; lastrankAllianceId: string };
    exactMatches: Array<{
      id: string;
      tag: string | null;
      name: string;
      gameServerNumber: number;
      score: number | null;
    }>;
    fuzzyMatches: Array<{
      id: string;
      tag: string | null;
      name: string;
      gameServerNumber: number;
      score: number | null;
    }>;
  }) => Promise<"create" | string>;
  retirePrompt: (ctx: {
    memberName: string;
    ashedMemberId: string;
  }) => Promise<boolean>;
  onPlanChanged: LastRankSyncPlanListener;
  onDispatchStart: LastRankSyncPlanListener;
  close: () => void;
  /** Removes the write-phase SIGINT listener after sync completes or aborts. */
  clearWritePhaseSigint: () => void;
} | null {
  if (!input.isTTY || !output.isTTY) {
    console.error(
      "--interactive requires a TTY; unmatched names / alliance picks / retire prompts will be skipped.",
    );
    return null;
  }

  const rl = readline.createInterface({ input, output });
  let closed = false;
  let latest: LastRankSyncPlanStats | null = null;
  let interruptArmed = false;
  let writePhaseSigintHandler: (() => void) | null = null;

  // Answers are only queued in memory, so an accidental Ctrl+C would discard
  // them. Warn once; a second press quits.
  rl.on("SIGINT", () => {
    const answered =
      latest != null &&
      lastRankSyncPlanQueuedCount(latest) + latest.skipped > 0;
    if (!answered || interruptArmed) {
      console.error("\nAborted — nothing was written.");
      process.exit(130);
    }
    interruptArmed = true;
    console.error(
      `\nPress Ctrl+C again to quit. ${lastRankSyncPlanQueuedCount(latest!)} queued change(s) will be lost — nothing has been written yet.`,
    );
  });

  const close = () => {
    if (closed) return;
    closed = true;
    rl.close();
  };

  const clearWritePhaseSigint = () => {
    if (writePhaseSigintHandler) {
      process.removeListener("SIGINT", writePhaseSigintHandler);
      writePhaseSigintHandler = null;
    }
  };

  return {
    close,
    clearWritePhaseSigint,
    onPlanChanged: (stats) => {
      latest = stats;
      interruptArmed = false;
      console.error(formatLastRankSyncPlanStats(stats));
    },
    onDispatchStart: (stats) => {
      close();
      const queued = lastRankSyncPlanQueuedCount(stats);
      console.error("");
      console.error(
        queued > 0
          ? `Writing ${queued} queued change(s) (${stats.mapped} mapped, ${stats.creates} to create, ${stats.retires} to retire)…`
          : "No queued changes from prompts; writing remaining sync updates…",
      );
      clearWritePhaseSigint();
      let abortArmed = false;
      writePhaseSigintHandler = () => {
        if (abortArmed) {
          console.error("\nAborted during writes — the sync is partially applied.");
          process.exit(130);
        }
        abortArmed = true;
        console.error(
          "\nWrites in progress — stopping now leaves a partial sync. Press Ctrl+C again to abort.",
        );
      };
      process.on("SIGINT", writePhaseSigintHandler);
    },
    interactivePrompt: async (ctx) => {
      const choices = buildInteractiveHqChoices({
        suggestions: ctx.suggestions,
        remainingHqNames: ctx.remainingHqNames,
      });

      console.error("");
      console.error(
        `No auto-match for LastRank canon "${ctx.lastRankName}" (public_id=${ctx.publicId}).`,
      );
      console.error(`  Profile: ${ctx.profileUrl}`);
      if (ctx.unranked) {
        console.error(
          "  Unranked on LastRank — often a recent leaver still listed; leave blank to skip (do not create).",
        );
      }
      console.error("HQ roster choices:");
      if (choices.length === 0) {
        console.error("  (roster empty — no existing HQ members to pick)");
      } else {
        for (const [i, choice] of choices.entries()) {
          const score =
            choice.score != null
              ? ` (score ${choice.score.toFixed(2)}${choice.detail ? `: ${choice.detail}` : ""})`
              : "";
          console.error(`  ${i + 1}. ${choice.name}${score}`);
        }
      }
      if (!ctx.unranked) {
        console.error(
          `  C. Create new HQ member + commander from LastRank ("${ctx.lastRankName}")`,
        );
      }
      console.error(
        ctx.unranked
          ? "Enter a number, type an HQ roster name, or leave blank to skip."
          : "Enter a number, C to create, type an HQ roster name, or leave blank to skip.",
      );
      const answer = await rl.question("> ");
      return resolveInteractiveHqNameAnswer(answer, choices);
    },
    alliancePrompt: async (ctx) => {
      console.error("");
      console.error(
        `No exact HQ alliance for server ${ctx.target.gameServerNumber} tag "${ctx.target.tag}".`,
      );
      if (ctx.fuzzyMatches.length > 0) {
        console.error("Fuzzy tag matches:");
        for (const [i, row] of ctx.fuzzyMatches.entries()) {
          const score =
            row.score != null ? ` (score ${row.score.toFixed(2)})` : "";
          console.error(
            `  ${i + 1}. ${row.tag ?? "?"} — ${row.name}${score}`,
          );
        }
      }
      console.error(
        `Enter a number to use that alliance, type "create" to provision a new native alliance, or leave blank to abort.`,
      );
      const answer = (await rl.question("> ")).trim();
      if (!answer) {
        throw new Error("Alliance resolution cancelled.");
      }
      if (/^create$/i.test(answer)) {
        return "create";
      }
      const index = Number.parseInt(answer, 10);
      if (
        Number.isFinite(index) &&
        index >= 1 &&
        index <= ctx.fuzzyMatches.length
      ) {
        return ctx.fuzzyMatches[index - 1].id;
      }
      throw new Error(
        `Unrecognized alliance choice "${answer}" — enter a number or "create".`,
      );
    },
    retirePrompt: async (ctx) => {
      console.error("");
      console.error(
        `HQ member "${ctx.memberName}" is active locally but missing from LastRank.`,
      );
      console.error("Retire as former? [y/N]");
      const answer = (await rl.question("> ")).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    },
  };
}

async function main() {
  if (wantsHelp()) {
    printHelp();
    return;
  }

  const apply = process.argv.includes("--apply");
  const createAll = process.argv.includes("--create-all");
  const retireAll = process.argv.includes("--retire-all");
  const wantInteractive = process.argv.includes("--interactive");
  const saveAshedCredential = process.argv.includes("--save-ashed-credential");
  const hqOnly = process.argv.includes("--hq-only");
  const ashedConnectionKey =
    arg("--ashed-connection-key") ??
    process.env.LASTRANK_ASHED_CONNECTION_KEY ??
    undefined;

  if (createAll && !apply) {
    throw new Error("--create-all requires --apply (creates HQ members + commanders).");
  }
  if (retireAll && !apply) {
    throw new Error("--retire-all requires --apply (marks excess HQ members former).");
  }
  if (saveAshedCredential && !ashedConnectionKey?.trim()) {
    throw new Error("--save-ashed-credential requires --ashed-connection-key or LASTRANK_ASHED_CONNECTION_KEY.");
  }
  if (hqOnly && ashedConnectionKey?.trim()) {
    throw new Error("Do not pass --ashed-connection-key with --hq-only.");
  }

  const databaseHost = databaseHostFromUrl(resolveDatabaseUrl(process.env));
  console.error(
    `Database: ${databaseHost} (${isLocalDatabaseHost(databaseHost) ? "local" : "REMOTE"})`,
  );
  assertCliDatabaseHostConfirmed({
    host: databaseHost,
    writes: apply || wantInteractive || saveAshedCredential,
    confirmHost: arg("--confirm-host"),
  });

  const lastrankAllianceId = arg("--id") ?? process.env.LASTRANK_ALLIANCE_ID;
  const tag = arg("--tag") ?? process.env.LASTRANK_SYNC_TAG;
  const gameServerNumber =
    argInt("--server") ??
    (process.env.LASTRANK_SYNC_SERVER
      ? Number.parseInt(process.env.LASTRANK_SYNC_SERVER, 10)
      : undefined);

  const target = resolveLastRankSyncCliTarget({
    lastrankAllianceId,
    tag,
    gameServerNumber,
  });

  const { syncLastRankAlliance } = await import(
    "@/lib/lastrank/sync-alliance.server"
  );
  const { formatLastRankRosterDiffText } = await import(
    "@/lib/lastrank/roster-diff.shared"
  );

  const tty = wantInteractive ? createTtyPrompts() : null;

  try {
    const result = await syncLastRankAlliance({
      target,
      apply,
      createAllUnmatched: createAll,
      retireAllUnmatched: retireAll,
      ashedConnectionKey: hqOnly ? undefined : ashedConnectionKey,
      saveAshedCredential: hqOnly ? false : saveAshedCredential,
      hqOnly,
      interactivePrompt: tty?.interactivePrompt,
      alliancePrompt: tty?.alliancePrompt,
      retirePrompt:
        apply && !retireAll && wantInteractive ? tty?.retirePrompt : undefined,
      onPlanChanged: tty?.onPlanChanged,
      onDispatchStart: tty?.onDispatchStart,
    });

    console.error(
      formatLastRankRosterDiffText({
        tag: result.tag,
        gameServerNumber: result.gameServerNumber,
        diff: result.rosterDiff,
      }),
    );
    if (result.ashedCredentialSaved) {
      console.error("Ashed bot credential: saved.");
    }
    console.error(
      result.ashedDualWrite
        ? "Ashed dual-write: available."
        : "Ashed dual-write: unavailable (native or missing bot credential).",
    );
    const unmatchedCount = result.match.unmatched.filter(
      (r) => r.status === "unmatched",
    ).length;
    if (apply && !createAll && unmatchedCount > 0) {
      console.error(
        `${unmatchedCount} LastRank member(s) unmatched and NOT created — --apply only updates matches. ` +
          "Re-run with --create-all (new/empty alliance) or --interactive to map/create.",
      );
    }

    console.log(
      JSON.stringify(
        {
          tag: result.tag,
          gameServerNumber: result.gameServerNumber,
          lastrankAllianceId: result.lastrankAllianceId,
          hqAllianceId: result.hqAllianceId,
          allianceCreated: result.allianceCreated,
          lastRankCount: result.lastRankCount,
          rosterDiff: result.rosterDiff,
          ashedCredentialSaved: result.ashedCredentialSaved,
          ashedDualWrite: result.ashedDualWrite,
          matched: result.match.matched.length,
          unmatched: result.match.unmatched.filter(
            (r) => r.status === "unmatched",
          ).length,
          ambiguous: result.match.unmatched.filter(
            (r) => r.status === "ambiguous",
          ).length,
          unmatchedHq: result.match.unmatchedHq.length,
          matchMethods: result.match.matched.reduce<Record<string, number>>(
            (acc, row) => {
              acc[row.matchMethod] = (acc[row.matchMethod] ?? 0) + 1;
              return acc;
            },
            {},
          ),
          ranks: result.match.matched.reduce<Record<string, number>>(
            (acc, row) => {
              const key =
                row.lastRank.allianceRank != null
                  ? `R${row.lastRank.allianceRank}`
                  : "unset";
              acc[key] = (acc[key] ?? 0) + 1;
              return acc;
            },
            {},
          ),
          apply: result.apply,
          unmatchedNames: result.match.unmatched.map((r) => ({
            status: r.status,
            name: r.lastRank.name,
            suggestions: r.suggestions.slice(0, 3).map((s) => ({
              name: s.name,
              score: Number(s.score.toFixed(2)),
            })),
          })),
          unmatchedHqNames: result.match.unmatchedHq.map(
            (r) => r.currentNames[0] ?? r.previousNames[0],
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    tty?.clearWritePhaseSigint();
    tty?.close();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
