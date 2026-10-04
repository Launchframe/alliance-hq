/**
 * Resolve pasted officer power lists to LastRank profile hyperlinks.
 *
 * See `printHelp()` / `--help`.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { stdin as input } from "node:process";
import { config } from "dotenv";

import { resolveLastRankSyncCliTarget } from "@/lib/lastrank/sync-registry.shared";
import {
  formatPasteProfileLinksMarkdown,
  matchPasteNamesToLastRankMembers,
  pasteNamesFromPowerList,
} from "@/lib/lastrank/paste-power-list.shared";

const require = createRequire(import.meta.url);
require("./register-server-only.cjs");

config({ path: ".env.local" });
config();

function printHelp(): void {
  console.log(`Usage:
  npx tsx scripts/lastrank/profile-links.ts --server <n> --tag <tag> [--name <label>]
  npx tsx scripts/lastrank/profile-links.ts --id <lastrankAllianceId> [--name <label>]
  npm run lastrank:profile-links -- --server <n> --tag <tag>

Paste a power list on stdin (Ctrl-D when done), or pass --file <path>.

Target (required — one of):
  --server <number>   Game server number (with --tag)
  --tag <tag>         Alliance tag on that server (with --server)
  --id <hex>          LastRank alliance id (32-char hex)

Optional:
  --name <label>      Alliance display name for the Markdown heading
  --file <path>       Read paste list from a file instead of stdin
  -h, --help          Show this help and exit

Examples:
  # Paste then Ctrl-D
  npx tsx scripts/lastrank/profile-links.ts --server 1203 --tag BigD --name "Big Daddies"

  npx tsx scripts/lastrank/profile-links.ts --server 1203 --tag BigD --file list.txt

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

async function readPasteText(): Promise<string> {
  const filePath = arg("--file");
  if (filePath) {
    return readFileSync(filePath, "utf8");
  }
  if (input.isTTY) {
    console.error(
      "Paste the power list, then press Ctrl-D (or Ctrl-Z on Windows) when done:",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (wantsHelp()) {
    printHelp();
    return;
  }

  const lastrankAllianceId = arg("--id") ?? process.env.LASTRANK_ALLIANCE_ID;
  const tag = arg("--tag") ?? process.env.LASTRANK_SYNC_TAG;
  const gameServerNumber =
    argInt("--server") ??
    (process.env.LASTRANK_SYNC_SERVER
      ? Number.parseInt(process.env.LASTRANK_SYNC_SERVER, 10)
      : undefined);
  const allianceName = arg("--name") ?? null;

  const target = resolveLastRankSyncCliTarget({
    lastrankAllianceId,
    tag,
    gameServerNumber,
  });

  const pasteText = await readPasteText();
  const pasteNames = pasteNamesFromPowerList(pasteText);
  if (pasteNames.length === 0) {
    throw new Error(
      "No names found in paste — expected lines like \"Name - 142M\".",
    );
  }

  const { fetchLastRankAlliancePage } = await import(
    "@/lib/lastrank/fetch-alliance.server"
  );
  const page = await fetchLastRankAlliancePage(target.lastrankAllianceId);
  const result = matchPasteNamesToLastRankMembers(pasteNames, page.members);

  const markdown = formatPasteProfileLinksMarkdown({
    tag: target.tag,
    gameServerNumber: target.gameServerNumber,
    allianceName,
    matched: result.matched,
  });
  process.stdout.write(markdown);

  if (result.unmatched.length > 0) {
    console.error("");
    console.error(
      `Unmatched / ambiguous (${result.unmatched.length} of ${pasteNames.length}):`,
    );
    for (const row of result.unmatched) {
      const tip =
        row.suggestions.length > 0
          ? ` — suggestions: ${row.suggestions
              .slice(0, 3)
              .map((s) => `${s.name} (${s.score.toFixed(2)})`)
              .join(", ")}`
          : "";
      console.error(`  [${row.status}] ${row.pasteName}${tip}`);
    }
  }

  console.error(
    `Resolved ${result.matched.length}/${pasteNames.length} → LastRank profiles.`,
  );

  if (result.matched.length === 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
