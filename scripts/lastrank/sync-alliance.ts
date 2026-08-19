/**
 * Fetch LastRank alliance page and match/sync into HQ.
 *
 * Dry-run (default):
 *   npx tsx scripts/lastrank/sync-alliance.ts --tag LFgo --id e7d1eaefdcfc42c8ac6c84247d2dad9b
 *
 * Interactive mapping for unmatched names (TTY):
 *   npx tsx scripts/lastrank/sync-alliance.ts --tag LFgo --id … --interactive
 *
 * Write THP / HQ level / power / canonical name for matches:
 *   npx tsx scripts/lastrank/sync-alliance.ts --tag LFgo --id … --apply
 *   npx tsx scripts/lastrank/sync-alliance.ts --tag LFgo --id … --apply --interactive
 */
import { createRequire } from "node:module";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { config } from "dotenv";

const require = createRequire(import.meta.url);
require("./register-server-only.cjs");

config({ path: ".env.local" });
config();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}

function createInteractivePrompt(): {
  prompt: (ctx: {
    lastRankName: string;
    publicId: number;
    suggestions: Array<{ name: string; score: number }>;
    remainingHqNames: string[];
  }) => Promise<string | null>;
  close: () => void;
} | null {
  if (!input.isTTY || !output.isTTY) {
    console.error(
      "--interactive requires a TTY; unmatched names will stay unmatched.",
    );
    return null;
  }

  const rl = readline.createInterface({ input, output });

  return {
    close: () => rl.close(),
    prompt: async (ctx) => {
      console.error("");
      console.error(
        `No auto-match for LastRank canon "${ctx.lastRankName}" (public_id=${ctx.publicId}).`,
      );
      if (ctx.suggestions.length > 0) {
        console.error("Closest HQ names:");
        for (const suggestion of ctx.suggestions.slice(0, 5)) {
          console.error(
            `  - ${suggestion.name} (score ${suggestion.score.toFixed(2)})`,
          );
        }
      }
      console.error(
        "Enter the HQ roster name to map this LastRank name to, or leave blank to skip.",
      );
      const answer = await rl.question("> ");
      return answer.trim() ? answer.trim() : null;
    },
  };
}

async function main() {
  const { syncLastRankAlliance } = await import(
    "@/lib/lastrank/sync-alliance.server"
  );

  const tag = arg("--tag") ?? process.env.LASTRANK_SYNC_TAG ?? "LFgo";
  const lastrankAllianceId =
    arg("--id") ??
    process.env.LASTRANK_ALLIANCE_ID ??
    "e7d1eaefdcfc42c8ac6c84247d2dad9b";
  const apply = process.argv.includes("--apply");
  const wantInteractive = process.argv.includes("--interactive");

  const interactive = wantInteractive ? createInteractivePrompt() : null;

  try {
    const result = await syncLastRankAlliance({
      tag,
      lastrankAllianceId,
      apply,
      interactivePrompt: interactive?.prompt,
    });

    console.log(
      JSON.stringify(
        {
          tag: result.tag,
          lastrankAllianceId: result.lastrankAllianceId,
          hqAllianceId: result.hqAllianceId,
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
    interactive?.close();
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
