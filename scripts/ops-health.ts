#!/usr/bin/env npx tsx
/**
 * Ping /api/health (local or production).
 * Usage: OPS_BASE_URL=https://frontline.gay npm run ops:health
 */

const base = (
  process.env.OPS_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:5175"
).replace(/\/$/, "");

async function main(): Promise<void> {
  const url = `${base}/api/health`;
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.text();
  console.log(`GET ${url}`);
  console.log(`Status: ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body);
  }
  process.exit(res.ok ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
