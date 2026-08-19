/**
 * Fetch LastRank alliance page and match/sync into HQ.
 *
 * Dry-run (default):
 *   npx tsx scripts/lastrank/sync-alliance.ts --tag LFgo --id e7d1eaefdcfc42c8ac6c84247d2dad9b
 *
 * Write THP / HQ level / power for exact name matches:
 *   npx tsx scripts/lastrank/sync-alliance.ts --tag LFgo --id e7d1eaefdcfc42c8ac6c84247d2dad9b --apply
 */
import { createRequire } from "node:module";
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

  const result = await syncLastRankAlliance({
    tag,
    lastrankAllianceId,
    apply,
  });

  console.log(
    JSON.stringify(
      {
        tag: result.tag,
        lastrankAllianceId: result.lastrankAllianceId,
        hqAllianceId: result.hqAllianceId,
        lastRankCount: result.lastRankCount,
        matched: result.match.matched.length,
        unmatched: result.match.unmatched.filter((r) => r.status === "unmatched")
          .length,
        ambiguous: result.match.unmatched.filter((r) => r.status === "ambiguous")
          .length,
        unmatchedHq: result.match.unmatchedHq.length,
        apply: result.apply,
        unmatchedNames: result.match.unmatched.map((r) => ({
          status: r.status,
          name: r.lastRank.name,
        })),
        unmatchedHqNames: result.match.unmatchedHq.map((r) => r.names[0]),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
