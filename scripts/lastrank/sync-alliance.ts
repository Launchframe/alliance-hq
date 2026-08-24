/**
 * Fetch LastRank alliance page and match/sync into HQ.
 *
 * See `printHelp()` / `--help` for flags and first-pass `--create-all` usage.
 */
import { createRequire } from "node:module";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config } from "dotenv";

import {
  buildInteractiveHqChoices,
  resolveInteractiveHqNameAnswer,
} from "@/lib/lastrank/alliance-page.shared";
import { resolveLastRankSyncCliTarget } from "@/lib/lastrank/sync-registry.shared";

const require = createRequire(import.meta.url);
require("./register-server-only.cjs");

config({ path: ".env.local" });
config();

function printHelp(): void {
  console.log(`Usage:
  npx tsx scripts/lastrank/sync-alliance.ts --server <n> --tag <tag> [flags]
  npx tsx scripts/lastrank/sync-alliance.ts --id <lastrankAllianceId> [flags]
  npm run lastrank:sync -- --server <n> --tag <tag> [flags]

Target (required — one of):
  --server <number>   Game server number (with --tag)
  --tag <tag>         Alliance tag on that server (with --server)
  --id <hex>          LastRank alliance id (32-char hex)

  Env fallbacks: LASTRANK_SYNC_SERVER + LASTRANK_SYNC_TAG, or LASTRANK_ALLIANCE_ID

Flags:
  --apply             Write matches (stats, ranks, profile) and create/retire when prompted
  --create-all        With --apply: auto-create every remaining unmatched LastRank member
                      (first pass for a new/thin alliance). Ambiguous rows are still skipped.
                      Requires --apply.
  --interactive       TTY prompts: map unmatched names, pick fuzzy alliance, retire leavers
                      Name prompt: number = HQ choice, C = create one member, blank = skip
  -h, --help          Show this help and exit

Examples:
  # Dry-run match report
  npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag LFgo

  # First pass: create all unmatched members into HQ
  npx tsx scripts/lastrank/sync-alliance.ts --server 1203 --tag BigD --apply --create-all

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
  interactivePrompt: (ctx: {
    lastRankName: string;
    publicId: number;
    suggestions: Array<{ name: string; score: number }>;
    remainingHqNames: string[];
  }) => Promise<
    import("@/lib/lastrank/alliance-page.shared").LastRankInteractiveAnswer
  >;
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
  close: () => void;
} | null {
  if (!input.isTTY || !output.isTTY) {
    console.error(
      "--interactive requires a TTY; unmatched names / alliance picks / retire prompts will be skipped.",
    );
    return null;
  }

  const rl = readline.createInterface({ input, output });

  return {
    close: () => rl.close(),
    interactivePrompt: async (ctx) => {
      const choices = buildInteractiveHqChoices({
        suggestions: ctx.suggestions.map((row) => ({
          commanderId: "",
          name: row.name,
          score: row.score,
        })),
        remainingHqNames: ctx.remainingHqNames,
      });

      console.error("");
      console.error(
        `No auto-match for LastRank canon "${ctx.lastRankName}" (public_id=${ctx.publicId}).`,
      );
      console.error("HQ roster choices:");
      if (choices.length === 0) {
        console.error("  (roster empty — no existing HQ members to pick)");
      } else {
        for (const [i, choice] of choices.entries()) {
          const score =
            choice.score != null
              ? ` (score ${choice.score.toFixed(2)})`
              : "";
          console.error(`  ${i + 1}. ${choice.name}${score}`);
        }
      }
      console.error(
        `  C. Create new HQ member + commander from LastRank ("${ctx.lastRankName}")`,
      );
      console.error(
        "Enter a number, C to create, type an HQ roster name, or leave blank to skip.",
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
  const wantInteractive = process.argv.includes("--interactive");

  if (createAll && !apply) {
    throw new Error("--create-all requires --apply (creates HQ members + commanders).");
  }

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

  const tty = wantInteractive ? createTtyPrompts() : null;

  try {
    const result = await syncLastRankAlliance({
      target,
      apply,
      createAllUnmatched: createAll,
      interactivePrompt: tty?.interactivePrompt,
      alliancePrompt: tty?.alliancePrompt,
      retirePrompt: apply ? tty?.retirePrompt : undefined,
    });

    console.log(
      JSON.stringify(
        {
          tag: result.tag,
          gameServerNumber: result.gameServerNumber,
          lastrankAllianceId: result.lastrankAllianceId,
          hqAllianceId: result.hqAllianceId,
          allianceCreated: result.allianceCreated,
          lastRankCount: result.lastRankCount,
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
