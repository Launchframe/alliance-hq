#!/usr/bin/env node
/**
 * Fetch VS daily rankings from api.lastwar.tools and filter to one alliance.
 *
 * Requires:
 *   LWT_API_KEY
 *   LWT_SESSION_KEY
 * Optional:
 *   LWT_ALLIANCE_TAG / --alliance-tag
 *   LWT_API_BASE (default https://api.lastwar.tools)
 *
 * Day is VS-week day 1–6 (Mon–Sat), not a calendar date.
 * Example (Monday 2026-07-20): --day 1
 *
 * UIDs are redacted in stdout by default (privacy). Pass --show-uid to print raw.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API_BASE = (process.env.LWT_API_BASE || "https://api.lastwar.tools").replace(
  /\/$/,
  "",
);

function parseArgs(argv) {
  const out = {
    day: 1,
    allianceTag: process.env.LWT_ALLIANCE_TAG || "",
    showUid: false,
    outPath: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--day") out.day = Number(argv[++i]);
    else if (a === "--alliance-tag") out.allianceTag = String(argv[++i] || "");
    else if (a === "--show-uid") out.showUid = true;
    else if (a === "--out") out.outPath = String(argv[++i] || "");
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function redactUid(uid) {
  const s = String(uid || "");
  if (s.length <= 4) return "****";
  return `…${s.slice(-4)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/lastwar-tools/fetch-vs-daily.mjs --day 1 [--alliance-tag TAG]
Env: LWT_API_KEY LWT_SESSION_KEY [LWT_ALLIANCE_TAG]`);
    process.exit(0);
  }

  const apiKey = process.env.LWT_API_KEY?.trim();
  const sessionKey = process.env.LWT_SESSION_KEY?.trim();
  if (!apiKey || !sessionKey) {
    console.error("Need LWT_API_KEY and LWT_SESSION_KEY in the environment.");
    process.exit(1);
  }
  if (!Number.isInteger(args.day) || args.day < 1 || args.day > 6) {
    console.error("--day must be an integer 1–6 (Mon–Sat of the VS week).");
    process.exit(1);
  }

  const url = new URL(`${API_BASE}/vs/rankings/daily`);
  url.searchParams.set("session_key", sessionKey);
  url.searchParams.set("day", String(args.day));

  const res = await fetch(url, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, body);
    process.exit(2);
  }

  const rankings = Array.isArray(body.rankings) ? body.rankings : [];
  const tag = args.allianceTag.trim();
  const filtered = tag
    ? rankings.filter(
        (r) =>
          String(r.alliance_abbr || "").toLowerCase() === tag.toLowerCase(),
      )
    : rankings;

  const rows = filtered.map((r) => ({
    rank: r.rank,
    name: r.name,
    score: r.score,
    alliance_abbr: r.alliance_abbr,
    alliance_name: r.alliance_name,
    server_id: r.server_id,
    uid: args.showUid ? r.uid : redactUid(r.uid),
    uid_raw: args.showUid ? r.uid : undefined,
  }));

  const summary = {
    success: body.success,
    day: body.day ?? args.day,
    rank_type: body.rank_type,
    player_count: body.player_count,
    alliance_tag_filter: tag || null,
    matched: rows.length,
    message: body.message,
  };

  if (args.outPath) {
    const payload = { ...summary, rankings: filtered };
    writeFileSync(resolve(args.outPath), JSON.stringify(payload, null, 2));
    console.error(`Wrote ${args.outPath} (${filtered.length} rows)`);
  }

  if (args.json) {
    console.log(JSON.stringify({ ...summary, rankings: rows }, null, 2));
  } else {
    console.log(
      `VS daily day=${summary.day} type=${summary.rank_type} ` +
        `total=${rankings.length} matched=${rows.length}` +
        (tag ? ` tag=${tag}` : ""),
    );
    console.log("rank\tscore\tname\talliance\tuid");
    for (const r of rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))) {
      console.log(
        `${r.rank}\t${r.score}\t${r.name}\t${r.alliance_abbr}\t${r.uid}`,
      );
    }
  }

  if (tag && rows.length === 0) {
    console.error(
      `No rows for alliance tag ${tag}. Sample tags in response:`,
      [...new Set(rankings.map((r) => r.alliance_abbr).filter(Boolean))].slice(
        0,
        20,
      ),
    );
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
