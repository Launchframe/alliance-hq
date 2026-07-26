#!/usr/bin/env npx tsx
/**
 * List recent unresolved Sentry issues.
 * Requires SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT.
 */

const org = process.env.SENTRY_ORG;
const project = process.env.SENTRY_PROJECT;
const token = process.env.SENTRY_AUTH_TOKEN;

async function main(): Promise<void> {
  if (!org || !project || !token) {
    console.error("Set SENTRY_ORG, SENTRY_PROJECT, and SENTRY_AUTH_TOKEN");
    process.exit(1);
  }

  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&limit=10`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`Sentry API ${res.status}:`, await res.text());
    process.exit(1);
  }
  const issues = (await res.json()) as Array<{
    id: string;
    title: string;
    culprit: string;
    lastSeen: string;
    count: string;
  }>;
  if (issues.length === 0) {
    console.log("No unresolved issues.");
    return;
  }
  for (const issue of issues) {
    console.log(`[${issue.count}x] ${issue.title}`);
    console.log(`  culprit: ${issue.culprit}`);
    console.log(`  lastSeen: ${issue.lastSeen}`);
    console.log(`  id: ${issue.id}`);
    console.log("");
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
