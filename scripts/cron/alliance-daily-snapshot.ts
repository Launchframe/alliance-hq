#!/usr/bin/env node
/**
 * Daily alliance analytics snapshot cron.
 * Usage: npx tsx scripts/cron/alliance-daily-snapshot.ts
 */
import { runAllianceDailySnapshotPass } from "@/lib/analytics/alliance-daily-snapshot.server";

const count = await runAllianceDailySnapshotPass();
console.log(`Alliance daily snapshots written: ${count}`);
