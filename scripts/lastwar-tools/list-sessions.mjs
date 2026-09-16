#!/usr/bin/env node
/** List lastwar.tools session keys for the current API key. */

const API_BASE = (process.env.LWT_API_BASE || "https://api.lastwar.tools").replace(
  /\/$/,
  "",
);

async function main() {
  const apiKey = process.env.LWT_API_KEY?.trim();
  if (!apiKey) {
    console.error("Need LWT_API_KEY");
    process.exit(1);
  }
  const res = await fetch(`${API_BASE}/auth/sessions`, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, body);
    process.exit(2);
  }
  console.log(JSON.stringify(body, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
