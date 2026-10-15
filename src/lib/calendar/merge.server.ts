import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { schema } from "@/lib/db";

import type { CalendarTx } from "./access.server";
import { lockCalendarTarget, lockCalendarUser } from "./repository.server";

type PrefRow = { hqUserId: string };
type AccountRow = typeof schema.calendarAccounts.$inferSelect;
type TargetRow = typeof schema.calendarTargets.$inferSelect;

export type CalendarMergeTx = Pick<
  CalendarTx,
  "select" | "update" | "delete" | "execute"
>;

/**
 * Apply calendar ownership moves after both users' rows have been loaded.
 * Exported for unit tests; production callers use {@link remapCalendarUserForMerge}.
 */
export async function applyCalendarMergeRemap(
  tx: Pick<CalendarTx, "update" | "delete" | "execute">,
  input: {
    sourceId: string;
    canonicalId: string;
    prefs: PrefRow[];
    sourceOauthCount: number;
    accounts: AccountRow[];
    targets: TargetRow[];
  },
): Promise<void> {
  const { sourceId, canonicalId, prefs, accounts, targets } = input;

  const canonicalHasPref = prefs.some((row) => row.hqUserId === canonicalId);
  const sourceHasPref = prefs.some((row) => row.hqUserId === sourceId);
  if (canonicalHasPref && sourceHasPref) {
    await tx
      .delete(schema.calendarPreferences)
      .where(eq(schema.calendarPreferences.hqUserId, sourceId));
  } else if (sourceHasPref) {
    await tx
      .update(schema.calendarPreferences)
      .set({ hqUserId: canonicalId })
      .where(eq(schema.calendarPreferences.hqUserId, sourceId));
  }

  if (input.sourceOauthCount > 0) {
    await tx
      .delete(schema.calendarOauthStates)
      .where(eq(schema.calendarOauthStates.hqUserId, sourceId));
  }

  const canonicalAccount = accounts.find((row) => row.hqUserId === canonicalId);
  const sourceAccount = accounts.find((row) => row.hqUserId === sourceId);
  const keptGoogleAccountId =
    canonicalAccount?.id ?? sourceAccount?.id ?? null;

  const sourceTargets = targets
    .filter((row) => row.hqUserId === sourceId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const canonicalTargets = targets.filter(
    (row) => row.hqUserId === canonicalId,
  );

  for (const target of sourceTargets) {
    await lockCalendarTarget(tx as CalendarTx, target.id);
    const conflict = canonicalTargets.some(
      (row) =>
        row.allianceId === target.allianceId &&
        row.provider === target.provider,
    );
    if (conflict) {
      await tx
        .delete(schema.calendarTargets)
        .where(eq(schema.calendarTargets.id, target.id));
      continue;
    }

    const nextAccountId =
      target.provider === "google" ? keptGoogleAccountId : target.accountId;
    const accountChanged =
      target.provider === "google" &&
      target.accountId != null &&
      nextAccountId != null &&
      target.accountId !== nextAccountId;
    const googleNeedsReconnect =
      target.provider === "google" && target.enabled && !nextAccountId;
    const resetRemote = accountChanged || googleNeedsReconnect;

    await tx
      .update(schema.calendarTargets)
      .set({
        hqUserId: canonicalId,
        accountId: nextAccountId,
        generation: target.generation + 1,
        scanCursor: 0,
        nextSyncAt: new Date(),
        ...(resetRemote
          ? {
              remoteCalendarId: null,
              creationUncertain: false,
              leaseToken: null,
              leaseUntil: null,
            }
          : {}),
        status: googleNeedsReconnect
          ? "reconnect"
          : target.provider === "google" && target.enabled
            ? "pending"
            : target.status,
      })
      .where(eq(schema.calendarTargets.id, target.id));

    if (resetRemote) {
      await tx
        .update(schema.calendarEntries)
        .set({
          remoteId: null,
          appliedRevision: 0,
          uncertain: false,
          remoteConfirmed: false,
        })
        .where(eq(schema.calendarEntries.targetId, target.id));
    }
  }

  if (sourceAccount && !canonicalAccount) {
    await tx
      .update(schema.calendarAccounts)
      .set({ hqUserId: canonicalId, updatedAt: new Date() })
      .where(eq(schema.calendarAccounts.id, sourceAccount.id));
  } else if (sourceAccount && canonicalAccount) {
    await tx
      .delete(schema.calendarAccounts)
      .where(eq(schema.calendarAccounts.id, sourceAccount.id));
  }
}

/**
 * Move calendar preferences, Google OAuth tokens, and sync targets from a
 * source HQ user onto the canonical user before the source row is deleted.
 * Without this, ON DELETE CASCADE on hq_users silently wipes Google refresh
 * tokens and stops alliance calendar sync after account merge.
 */
export async function remapCalendarUserForMerge(
  tx: CalendarMergeTx,
  sourceId: string,
  canonicalId: string,
): Promise<void> {
  if (sourceId === canonicalId) return;

  const [lockFirst, lockSecond] =
    sourceId < canonicalId
      ? [sourceId, canonicalId]
      : [canonicalId, sourceId];
  await lockCalendarUser(tx as CalendarTx, lockFirst);
  await lockCalendarUser(tx as CalendarTx, lockSecond);

  const prefs = await tx
    .select({ hqUserId: schema.calendarPreferences.hqUserId })
    .from(schema.calendarPreferences)
    .where(
      inArray(schema.calendarPreferences.hqUserId, [sourceId, canonicalId]),
    );

  const sourceOauthRows = await tx
    .select({ hash: schema.calendarOauthStates.hash })
    .from(schema.calendarOauthStates)
    .where(eq(schema.calendarOauthStates.hqUserId, sourceId))
    .limit(1);

  const accounts = await tx
    .select()
    .from(schema.calendarAccounts)
    .where(inArray(schema.calendarAccounts.hqUserId, [sourceId, canonicalId]));

  const targets = await tx
    .select()
    .from(schema.calendarTargets)
    .where(inArray(schema.calendarTargets.hqUserId, [sourceId, canonicalId]))
    .orderBy(asc(schema.calendarTargets.id));

  await applyCalendarMergeRemap(tx, {
    sourceId,
    canonicalId,
    prefs,
    sourceOauthCount: sourceOauthRows.length,
    accounts,
    targets,
  });
}
