import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import { defaultPlanColor, parsePlanColor } from "./colors.shared";
import { assertFuturePlan, expandPlan, isPlanDate, occurrenceIsAway, occurrenceOn, parsePlanSchedule } from "./schedule.shared";
import { resolvePlanIdentity, type PlanIdentity, type PlanTx } from "./access.server";
import { PlunderPlanError, type PlanActor, type PlanCommand, type PlanDashboard, type PlanSummary } from "./types.shared";

type Plan = typeof schema.plunderPlans.$inferSelect;

async function lockPlans(tx: PlanTx, allianceId: string) {
  await lockAllianceAvailability(tx, allianceId);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`plunder-plan:${allianceId}`}, 0))`);
}

async function aliasesFor(tx: PlanTx, ownerId: string): Promise<string[]> {
  const [kind, id] = ownerId.split(":");
  const linked = await tx.select().from(schema.discordHqLinks).where(kind === "hq" ? eq(schema.discordHqLinks.hqUserId, id) : eq(schema.discordHqLinks.discordUserId, id));
  return [...new Set([ownerId, ...linked.flatMap((row) => [`hq:${row.hqUserId}`, `discord:${row.discordUserId}`])])];
}

async function membershipKey(tx: PlanTx, allianceId: string, memberId: string): Promise<string | null> {
  const [row] = await tx.select({ id: schema.memberAllianceTenure.id, joinedAt: schema.memberAllianceTenure.joinedAt }).from(schema.memberAllianceTenure)
    .where(and(eq(schema.memberAllianceTenure.allianceId, allianceId), eq(schema.memberAllianceTenure.ashedMemberId, memberId), isNull(schema.memberAllianceTenure.leftAt)))
    .orderBy(desc(schema.memberAllianceTenure.joinedAt)).limit(1);
  return row ? `${row.id}:${row.joinedAt.toISOString()}` : null;
}

async function stillOwned(tx: PlanTx, plan: Plan): Promise<boolean> {
  if (!plan.memberId || !plan.membershipKey || plan.membershipKey !== await membershipKey(tx, plan.allianceId, plan.memberId)) return false;
  const aliases = await aliasesFor(tx, plan.ownerId);
  for (const alias of aliases) {
    const [kind, id] = alias.split(":");
    if (kind === "hq") {
      const [legacy] = await tx.select({ id: schema.hqMemberLinks.id }).from(schema.hqMemberLinks).where(and(eq(schema.hqMemberLinks.allianceId, plan.allianceId), eq(schema.hqMemberLinks.hqUserId, id), eq(schema.hqMemberLinks.ashedMemberId, plan.memberId))).limit(1);
      if (legacy) return true;
      const [canonical] = await tx.select({ id: schema.hqUserCommanders.commanderId }).from(schema.hqUserCommanders).innerJoin(schema.commanderAllianceMemberships, eq(schema.hqUserCommanders.commanderId, schema.commanderAllianceMemberships.commanderId))
        .where(and(eq(schema.hqUserCommanders.hqUserId, id), eq(schema.commanderAllianceMemberships.allianceId, plan.allianceId), eq(schema.commanderAllianceMemberships.ashedMemberId, plan.memberId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt))).limit(1);
      if (canonical) return true;
    } else {
      const [link] = await tx.select({ id: schema.discordMemberLinks.id }).from(schema.discordMemberLinks).where(and(eq(schema.discordMemberLinks.allianceId, plan.allianceId), eq(schema.discordMemberLinks.discordUserId, id), eq(schema.discordMemberLinks.ashedMemberId, plan.memberId))).limit(1);
      if (link) return true;
    }
  }
  return false;
}

async function personalColor(tx: PlanTx, allianceId: string, identity: Pick<PlanIdentity, "aliases" | "principalId">) {
  const [row] = await tx.select().from(schema.plunderPlanColors).where(and(eq(schema.plunderPlanColors.allianceId, allianceId), inArray(schema.plunderPlanColors.principalId, identity.aliases)))
    .orderBy(desc(schema.plunderPlanColors.updatedAt), desc(schema.plunderPlanColors.principalId)).limit(1);
  return { color: row?.color ?? defaultPlanColor(identity.principalId), version: row?.version ?? 0 };
}

export async function loadPlunderPlan(actor: PlanActor, from: string, until: string): Promise<PlanDashboard> {
  expandPlan(parsePlanSchedule({ kind: "weekly", date: "2026-01-01", days: [1], start: "12:00", end: "13:00", endsNextDay: false, zone: "UTC" }), from, until);
  return getDb().transaction(async (tx) => {
    await lockPlans(tx, actor.allianceId);
    const identity = await resolvePlanIdentity(tx, actor);
    const [state] = await tx.select().from(schema.plunderPlanState).where(eq(schema.plunderPlanState.allianceId, actor.allianceId));
    const color = await personalColor(tx, actor.allianceId, identity);
    const roster = await tx.select({ id: schema.allianceMembers.ashedMemberId, name: schema.allianceMembers.currentName, status: schema.allianceMembers.status }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, actor.allianceId));
    const rows = await tx.select().from(schema.plunderPlans).where(and(eq(schema.plunderPlans.allianceId, actor.allianceId), eq(schema.plunderPlans.removed, false))).orderBy(schema.plunderPlans.id);
    const absences = await tx.select({ memberId: schema.memberTimeOff.ashedMemberId, startDate: schema.memberTimeOff.startDate, endDate: schema.memberTimeOff.endDate }).from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.allianceId, actor.allianceId), eq(schema.memberTimeOff.globalAbsence, true), isNull(schema.memberTimeOff.cancelledAt)));
    const exceptions = rows.length ? await tx.select().from(schema.plunderPlanExceptions).where(inArray(schema.plunderPlanExceptions.planId, rows.map((row) => row.id))) : [];
    const ownerIds = [...new Set(rows.map((row) => row.ownerId))];
    const linked = ownerIds.length ? await tx.select().from(schema.discordHqLinks).where(or(inArray(schema.discordHqLinks.hqUserId, ownerIds.filter((id) => id.startsWith("hq:")).map((id) => id.slice(3))), inArray(schema.discordHqLinks.discordUserId, ownerIds.filter((id) => id.startsWith("discord:")).map((id) => id.slice(8))))) : [];
    const legacy = await tx.select({ owner: schema.hqMemberLinks.hqUserId, member: schema.hqMemberLinks.ashedMemberId }).from(schema.hqMemberLinks).where(eq(schema.hqMemberLinks.allianceId, actor.allianceId));
    const discord = await tx.select({ owner: schema.discordMemberLinks.discordUserId, member: schema.discordMemberLinks.ashedMemberId }).from(schema.discordMemberLinks).where(eq(schema.discordMemberLinks.allianceId, actor.allianceId));
    const canonical = await tx.select({ owner: schema.hqUserCommanders.hqUserId, member: schema.commanderAllianceMemberships.ashedMemberId }).from(schema.hqUserCommanders).innerJoin(schema.commanderAllianceMemberships, eq(schema.hqUserCommanders.commanderId, schema.commanderAllianceMemberships.commanderId)).where(and(eq(schema.commanderAllianceMemberships.allianceId, actor.allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
    const tenures = await tx.select({ member: schema.memberAllianceTenure.ashedMemberId, id: schema.memberAllianceTenure.id, joinedAt: schema.memberAllianceTenure.joinedAt }).from(schema.memberAllianceTenure).where(and(eq(schema.memberAllianceTenure.allianceId, actor.allianceId), isNull(schema.memberAllianceTenure.leftAt))).orderBy(desc(schema.memberAllianceTenure.joinedAt));
    const colors = await tx.select().from(schema.plunderPlanColors).where(eq(schema.plunderPlanColors.allianceId, actor.allianceId)).orderBy(desc(schema.plunderPlanColors.updatedAt), desc(schema.plunderPlanColors.principalId));
    const ownership = [...legacy, ...canonical].map((link) => ({ owner: `hq:${link.owner}`, member: link.member })).concat(discord.map((link) => ({ owner: `discord:${link.owner}`, member: link.member })));
    const result: PlanDashboard = { version: state?.version ?? 0, canSuggest: identity.canSuggest, commanders: roster.filter((row) => row.status !== "former" && identity.memberIds.includes(row.id)).map(({ id, name }) => ({ id, name })), plans: [], occurrences: [], suppressed: [], color: color.color, colorVersion: color.version };
    for (const row of rows) {
      const member = roster.find((member) => member.id === row.memberId && member.status !== "former");
      const owned = identity.aliases.includes(row.ownerId) && (row.kind === "suggestion" ? identity.canSuggest : identity.memberIds.includes(row.memberId!));
      const link = linked.find((link) => `hq:${link.hqUserId}` === row.ownerId || `discord:${link.discordUserId}` === row.ownerId);
      const aliases = link ? [`hq:${link.hqUserId}`, `discord:${link.discordUserId}`] : [row.ownerId];
      const tenure = tenures.find((tenure) => tenure.member === row.memberId);
      if (row.kind === "plan" && (!member || !tenure || `${tenure.id}:${tenure.joinedAt.toISOString()}` !== row.membershipKey || !ownership.some((link) => link.member === row.memberId && aliases.includes(link.owner)))) continue;
      const ownerColor = colors.find((color) => aliases.includes(color.principalId))?.color ?? defaultPlanColor(aliases[0]);
      const summary: PlanSummary = { id: row.id, memberId: row.memberId, memberName: member?.name ?? "", kind: row.kind, schedule: row.schedule, version: row.version, active: row.active, reminder: owned && row.reminder, owned, color: ownerColor };
      if (owned || row.kind === "suggestion") result.plans.push(summary);
      if (!row.active) continue;
      const expanded = expandPlan(row.schedule, from, until);
      if (owned) for (const date of expanded.skippedDates) result.suppressed.push({ planId: row.id, date, reason: "dstSkipped" });
      for (const occurrence of expanded.occurrences) {
        const skipped = exceptions.some((exception) => exception.planId === row.id && exception.scheduleVersion === row.scheduleVersion && exception.date === occurrence.key);
        const away = row.kind === "plan" && occurrenceIsAway(occurrence, absences.filter((absence) => absence.memberId === row.memberId));
        if (skipped || away) {
          if (owned) result.suppressed.push({ planId: row.id, date: occurrence.key, reason: skipped ? "skippedLabel" : row.schedule.kind === "weekly" ? "awayWeekly" : "awayOnce" });
          continue;
        }
        result.occurrences.push({ ...occurrence, id: `${row.id}:${row.version}:${occurrence.key}`, planId: row.id, memberName: summary.memberName, color: summary.color, kind: row.kind, owned, version: row.version });
      }
    }
    return result;
  });
}

export function parsePlanCommand(input: unknown): PlanCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new PlunderPlanError("invalidSchedule");
  const row = input as Record<string, unknown>;
  if (typeof row.requestId !== "string" || !/^[a-zA-Z0-9_-]{12,100}$/.test(row.requestId)) throw new PlunderPlanError("invalidSchedule");
  if (row.action === "create") {
    if ((row.kind !== "plan" && row.kind !== "suggestion") || typeof row.reminder !== "boolean" || (row.kind === "plan" && typeof row.memberId !== "string") || (row.sourceId !== undefined && typeof row.sourceId !== "string")) throw new PlunderPlanError("invalidSchedule");
    return { action: "create", requestId: row.requestId, kind: row.kind, memberId: row.memberId as string | undefined, sourceId: row.sourceId as string | undefined, schedule: parsePlanSchedule(row.schedule), reminder: row.reminder };
  }
  if (!Number.isSafeInteger(row.expectedVersion) || Number(row.expectedVersion) < 0) throw new PlunderPlanError("stale", 409);
  const expectedVersion = Number(row.expectedVersion);
  if (row.action === "color") {
    const color = parsePlanColor(row.color);
    if (!color) throw new PlunderPlanError("invalidColor");
    return { action: "color", requestId: row.requestId, expectedVersion, color };
  }
  if (typeof row.id !== "string" || !row.id || row.id.length > 100) throw new PlunderPlanError("notFound", 404);
  const base = { id: row.id, requestId: row.requestId, expectedVersion };
  if (row.action === "edit" && typeof row.reminder === "boolean") return { ...base, action: "edit", schedule: parsePlanSchedule(row.schedule), reminder: row.reminder };
  if (row.action === "pause" || row.action === "resume" || row.action === "remove") return { ...base, action: row.action };
  if ((row.action === "skip" || row.action === "restore") && isPlanDate(row.date)) return { ...base, action: row.action, date: row.date };
  throw new PlunderPlanError("invalidSchedule");
}

export async function mutatePlunderPlan(actor: PlanActor, input: unknown, interactionToken?: string) {
  const command = parsePlanCommand(input);
  const hash = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  return getDb().transaction(async (tx) => {
    await lockPlans(tx, actor.allianceId);
    const identity = await resolvePlanIdentity(tx, actor);
    if (!identity.canManageSelf) throw new PlunderPlanError("forbidden", 403);
    const actorId = actor.kind === "web" ? `hq:${actor.hqUserId}` : `discord:${actor.discordUserId}`;
    const [receipt] = await tx.select().from(schema.plunderPlanIntents).where(and(eq(schema.plunderPlanIntents.allianceId, actor.allianceId), eq(schema.plunderPlanIntents.actorId, actorId), eq(schema.plunderPlanIntents.requestId, command.requestId)));
    if (receipt) {
      if (receipt.requestHash !== hash) throw new PlunderPlanError("stale", 409);
      return receipt.result;
    }
    if (interactionToken) {
      if (actor.kind !== "discord") throw new PlunderPlanError("forbidden", 403);
      const [token] = await tx.select().from(schema.plunderPlanInteractions).where(and(eq(schema.plunderPlanInteractions.id, interactionToken), eq(schema.plunderPlanInteractions.allianceId, actor.allianceId), eq(schema.plunderPlanInteractions.guildId, actor.guildId), eq(schema.plunderPlanInteractions.discordUserId, actor.discordUserId))).for("update");
      if (!token || token.consumedAt || token.expiresAt <= new Date() || token.state.requestHash !== hash) throw new PlunderPlanError("expired", 409);
      await tx.update(schema.plunderPlanInteractions).set({ consumedAt: new Date() }).where(eq(schema.plunderPlanInteractions.id, token.id));
    }
    let id: string | undefined;
    if (command.action === "color") {
      const current = await personalColor(tx, actor.allianceId, identity);
      if (current.version !== command.expectedVersion) throw new PlunderPlanError("stale", 409);
      for (const principalId of identity.aliases) {
        const values = { allianceId: actor.allianceId, principalId, color: command.color, version: current.version + 1, updatedAt: new Date() };
        await tx.insert(schema.plunderPlanColors).values(values).onConflictDoUpdate({ target: [schema.plunderPlanColors.allianceId, schema.plunderPlanColors.principalId], set: values });
      }
    } else if (command.action === "create") {
      if (command.kind === "suggestion" && !identity.canSuggest) throw new PlunderPlanError("forbidden", 403);
      if (command.kind === "plan" && !identity.memberIds.includes(command.memberId!)) throw new PlunderPlanError("linkRequired", 403);
      const stint = command.kind === "plan" ? await membershipKey(tx, actor.allianceId, command.memberId!) : null;
      if (command.kind === "plan" && !stint) throw new PlunderPlanError("commanderUnavailable");
      if (command.sourceId) {
        const [source] = await tx.select().from(schema.plunderPlans).where(and(eq(schema.plunderPlans.id, command.sourceId), eq(schema.plunderPlans.allianceId, actor.allianceId), eq(schema.plunderPlans.kind, "suggestion"), eq(schema.plunderPlans.removed, false)));
        if (!source) throw new PlunderPlanError("notFound", 404);
      }
      assertFuturePlan(command.schedule);
      const current = await tx.select().from(schema.plunderPlans).where(and(eq(schema.plunderPlans.allianceId, actor.allianceId), inArray(schema.plunderPlans.ownerId, identity.aliases), eq(schema.plunderPlans.removed, false)));
      if (current.length >= 100) throw new PlunderPlanError("rateLimit", 429);
      if (current.some((row) => row.memberId === (command.memberId ?? null) && row.kind === command.kind && JSON.stringify(parsePlanSchedule(row.schedule)) === JSON.stringify(command.schedule))) throw new PlunderPlanError("duplicate", 409);
      id = nanoid();
      await tx.insert(schema.plunderPlans).values({ id, allianceId: actor.allianceId, ownerId: identity.principalId, memberId: command.kind === "plan" ? command.memberId : null, membershipKey: stint, kind: command.kind, schedule: command.schedule, sourceId: command.sourceId, reminder: command.kind === "plan" && command.reminder });
    } else {
      const [plan] = await tx.select().from(schema.plunderPlans).where(and(eq(schema.plunderPlans.id, command.id), eq(schema.plunderPlans.allianceId, actor.allianceId), eq(schema.plunderPlans.removed, false))).for("update");
      if (!plan) throw new PlunderPlanError("notFound", 404);
      if (plan.kind === "suggestion" ? !identity.canSuggest : !identity.aliases.includes(plan.ownerId) || !identity.memberIds.includes(plan.memberId!) || !await stillOwned(tx, plan)) throw new PlunderPlanError("forbidden", 403);
      if (plan.version !== command.expectedVersion) throw new PlunderPlanError("stale", 409);
      id = plan.id;
      if (command.action === "skip" || command.action === "restore") {
        const occurrence = occurrenceOn(plan.schedule, command.date);
        if (plan.schedule.kind !== "weekly" || !occurrence || occurrence.endAt <= new Date().toISOString()) throw new PlunderPlanError("invalidSchedule");
        if (command.action === "skip") await tx.insert(schema.plunderPlanExceptions).values({ planId: plan.id, date: command.date, scheduleVersion: plan.scheduleVersion }).onConflictDoNothing();
        else await tx.delete(schema.plunderPlanExceptions).where(and(eq(schema.plunderPlanExceptions.planId, plan.id), eq(schema.plunderPlanExceptions.date, command.date), eq(schema.plunderPlanExceptions.scheduleVersion, plan.scheduleVersion)));
      } else {
        if ((command.action === "pause" || command.action === "resume") && plan.schedule.kind !== "weekly") throw new PlunderPlanError("invalidSchedule");
        if (command.action === "edit") assertFuturePlan(command.schedule);
        await tx.update(schema.plunderPlans).set({ ...(command.action === "edit" ? { schedule: command.schedule, reminder: plan.kind === "plan" && command.reminder, scheduleVersion: plan.scheduleVersion + 1 } : command.action === "remove" ? { removed: true } : { active: command.action === "resume" }) }).where(eq(schema.plunderPlans.id, plan.id));
      }
      await tx.update(schema.plunderPlans).set({ version: plan.version + 1, updatedAt: new Date() }).where(eq(schema.plunderPlans.id, plan.id));
    }
    const [state] = await tx.insert(schema.plunderPlanState).values({ allianceId: actor.allianceId, version: 1 }).onConflictDoUpdate({ target: schema.plunderPlanState.allianceId, set: { version: sql`${schema.plunderPlanState.version} + 1` } }).returning();
    const result = { ...(id ? { id } : {}), version: state.version };
    await tx.insert(schema.plunderPlanIntents).values({ allianceId: actor.allianceId, actorId, requestId: command.requestId, requestHash: hash, result });
    return result;
  });
}
