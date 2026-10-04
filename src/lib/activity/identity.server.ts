import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import * as schema from "@/lib/db/schema";

import type { ActivityPrincipal } from "./access.server";
import type { ActivityEventKey } from "./catalog.shared";
import { ActivityWriteError, toActivityWriteError } from "./errors.server";
import { lockActivityIdentity } from "./ownership.server";
import { safeActivityServerNumber, safeVisibleName } from "./privacy.shared";
import {
  ACTIVITY_ROLES,
  activityActorSchema,
  activityIdentifierSchema,
  activityScopeSchema,
  type ActivityActor,
  type ActivityChannel,
  type ActivityMethod,
  type ActivityRole,
  type ActivityScope,
} from "./types.shared";
import type { ActivityTransaction } from "./writer.server";

export type ActivityAllianceReference = { kind: "hq" | "ashed"; id: string };

export type ActivityIdentity =
  | { kind: "web"; principal: ActivityPrincipal }
  | { kind: "discord"; discordUserId: string }
  | { kind: "automation" };

export type CapturedActivityContext = {
  actor: ActivityActor;
  scope: ActivityScope;
  channel: ActivityChannel;
  method: ActivityMethod | null;
};

type CommanderCandidate = {
  memberId: string;
  commanderId: string | null;
  name: string | null;
  primary: boolean;
};

function validationFailure(eventKey: ActivityEventKey): ActivityWriteError {
  return new ActivityWriteError({ eventKey, failureCategory: "validation" });
}

function requireIdentifier(
  value: string,
  eventKey: ActivityEventKey,
): string {
  const parsed = activityIdentifierSchema.safeParse(value);
  if (!parsed.success) {
    throw validationFailure(eventKey);
  }
  return parsed.data;
}

async function captureScope(
  tx: ActivityTransaction,
  input: { alliance: ActivityAllianceReference | null },
  eventKey: ActivityEventKey,
): Promise<ActivityScope> {
  const ref = input.alliance;
  if (ref === null) {
    return {
      allianceId: null,
      serverNumber: null,
      allianceTag: null,
      allianceName: null,
    };
  }
  const refId = requireIdentifier(ref.id, eventKey);
  if (ref.kind !== "hq" && ref.kind !== "ashed") {
    throw validationFailure(eventKey);
  }
  const [alliance] = await tx
    .select({
      id: schema.alliances.id,
      server: schema.alliances.gameServerNumber,
      tag: schema.alliances.tag,
      name: schema.alliances.name,
    })
    .from(schema.alliances)
    .where(
      ref.kind === "hq"
        ? eq(schema.alliances.id, refId)
        : eq(schema.alliances.ashedAllianceId, refId),
    )
    .limit(1);
  if (!alliance) {
    throw validationFailure(eventKey);
  }
  return {
    allianceId: alliance.id,
    serverNumber: safeActivityServerNumber(String(alliance.server)),
    allianceTag: safeVisibleName(alliance.tag)?.slice(0, 32) ?? null,
    allianceName: safeVisibleName(alliance.name),
  };
}

async function captureWebIdentity(
  tx: ActivityTransaction,
  principal: ActivityPrincipal,
  eventKey: ActivityEventKey,
): Promise<{
  hqUserId: string;
  hqDisplayName: string | null;
  hqAshedUserId: string | null;
}> {
  const hqUserId = requireIdentifier(principal.hqUserId, eventKey);
  const sessionId = requireIdentifier(principal.sessionId, eventKey);
  if (principal.currentAllianceId !== null) {
    requireIdentifier(principal.currentAllianceId, eventKey);
  }
  await lockActivityIdentity(tx, { hqUserIds: [hqUserId] });
  const [session] = await tx
    .select({
      hqUserId: schema.sessions.hqUserId,
      currentAllianceId: schema.sessions.currentAllianceId,
      expiresAt: schema.sessions.expiresAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .for("share");
  if (
    !session ||
    session.hqUserId !== hqUserId ||
    session.currentAllianceId !== principal.currentAllianceId ||
    session.expiresAt <= new Date()
  ) {
    throw validationFailure(eventKey);
  }
  const [hqUser] = await tx
    .select({
      id: schema.hqUsers.id,
      displayName: schema.hqUsers.displayName,
      ashedUserId: schema.hqUsers.ashedUserId,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .for("share");
  if (!hqUser) {
    throw validationFailure(eventKey);
  }
  return {
    hqUserId,
    hqDisplayName: hqUser.displayName,
    hqAshedUserId: hqUser.ashedUserId,
  };
}

async function captureDiscordIdentity(
  tx: ActivityTransaction,
  discordUserIdInput: string,
  eventKey: ActivityEventKey,
): Promise<{
  hqUserId: string | null;
  hqDisplayName: string | null;
  hqAshedUserId: string | null;
  discordUserId: string;
}> {
  const discordUserId = requireIdentifier(discordUserIdInput, eventKey);
  await lockActivityIdentity(tx, { discordUserId });
  const [link] = await tx
    .select({ hqUserId: schema.discordHqLinks.hqUserId })
    .from(schema.discordHqLinks)
    .where(eq(schema.discordHqLinks.discordUserId, discordUserId))
    .for("share");
  if (!link) {
    return {
      hqUserId: null,
      hqDisplayName: null,
      hqAshedUserId: null,
      discordUserId,
    };
  }
  const hqUserId = requireIdentifier(link.hqUserId, eventKey);
  await lockActivityIdentity(tx, { hqUserIds: [hqUserId] });
  const [hqUser] = await tx
    .select({
      id: schema.hqUsers.id,
      displayName: schema.hqUsers.displayName,
      ashedUserId: schema.hqUsers.ashedUserId,
    })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, hqUserId))
    .for("share");
  if (!hqUser) {
    throw validationFailure(eventKey);
  }
  return {
    hqUserId,
    hqDisplayName: hqUser.displayName,
    hqAshedUserId: hqUser.ashedUserId,
    discordUserId,
  };
}

async function captureHqRole(
  tx: ActivityTransaction,
  input: {
    identity: ActivityIdentity;
    hqUserId: string;
    hqAshedUserId: string | null;
    allianceId: string;
  },
): Promise<ActivityRole | null> {
  const [membership] = await tx
    .select({
      name: schema.roles.name,
      source: schema.allianceMemberships.source,
    })
    .from(schema.allianceMemberships)
    .innerJoin(
      schema.roles,
      eq(schema.roles.id, schema.allianceMemberships.roleId),
    )
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, input.hqUserId),
        eq(schema.allianceMemberships.allianceId, input.allianceId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (
    !membership ||
    !(ACTIVITY_ROLES as readonly string[]).includes(membership.name)
  ) {
    return null;
  }
  if (input.identity.kind === "web" && membership.source === "ashed") {
    const [credential] = await tx
      .select({ ashedUserId: schema.ashedCredentials.ashedUserId })
      .from(schema.ashedCredentials)
      .where(
        eq(
          schema.ashedCredentials.sessionId,
          input.identity.principal.sessionId,
        ),
      )
      .limit(1);
    if (
      credential?.ashedUserId &&
      (input.hqAshedUserId === null ||
        credential.ashedUserId !== input.hqAshedUserId)
    ) {
      return null;
    }
  }
  return membership.name as ActivityRole;
}

async function captureWebCommanderCandidates(
  tx: ActivityTransaction,
  hqUserId: string,
  allianceId: string,
): Promise<CommanderCandidate[]> {
  const canonical = await tx
    .select({
      memberId: schema.commanderAllianceMemberships.ashedMemberId,
      commanderId: schema.hqUserCommanders.commanderId,
      name: schema.commanderAllianceMemberships.rosterNameAtMembership,
      primary: schema.hqUserCommanders.isPrimary,
    })
    .from(schema.hqUserCommanders)
    .innerJoin(
      schema.commanderAllianceMemberships,
      eq(
        schema.commanderAllianceMemberships.commanderId,
        schema.hqUserCommanders.commanderId,
      ),
    )
    .where(
      and(
        eq(schema.hqUserCommanders.hqUserId, hqUserId),
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.status, "active"),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );
  const legacy = await tx
    .select({
      ashedMemberId: schema.hqMemberLinks.ashedMemberId,
      memberDisplayName: schema.hqMemberLinks.memberDisplayName,
    })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.hqUserId, hqUserId),
        eq(schema.hqMemberLinks.allianceId, allianceId),
      ),
    );
  const candidates = new Map<string, CommanderCandidate>();
  for (const row of canonical) {
    candidates.set(row.memberId, {
      memberId: row.memberId,
      commanderId: row.commanderId,
      name: row.name,
      primary: row.primary,
    });
  }
  for (const row of legacy) {
    if (!candidates.has(row.ashedMemberId)) {
      candidates.set(row.ashedMemberId, {
        memberId: row.ashedMemberId,
        commanderId: null,
        name: row.memberDisplayName,
        primary: false,
      });
    }
  }
  return [...candidates.values()];
}

async function captureDiscordCommanderCandidates(
  tx: ActivityTransaction,
  discordUserId: string,
  allianceId: string,
): Promise<CommanderCandidate[]> {
  const links = await tx
    .select({
      ashedMemberId: schema.discordMemberLinks.ashedMemberId,
      memberDisplayName: schema.discordMemberLinks.memberDisplayName,
    })
    .from(schema.discordMemberLinks)
    .where(
      and(
        eq(schema.discordMemberLinks.discordUserId, discordUserId),
        eq(schema.discordMemberLinks.allianceId, allianceId),
      ),
    );
  if (links.length === 0) {
    return [];
  }
  const memberIds = links.map((link) => link.ashedMemberId);
  const memberships = await tx
    .select({
      memberId: schema.commanderAllianceMemberships.ashedMemberId,
      commanderId: schema.commanderAllianceMemberships.commanderId,
    })
    .from(schema.commanderAllianceMemberships)
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        inArray(schema.commanderAllianceMemberships.ashedMemberId, memberIds),
        eq(schema.commanderAllianceMemberships.status, "active"),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );
  const commanderIdsByMember = new Map<string, Set<string>>();
  for (const row of memberships) {
    const seen = commanderIdsByMember.get(row.memberId) ?? new Set<string>();
    seen.add(row.commanderId);
    commanderIdsByMember.set(row.memberId, seen);
  }
  return links.map((link) => {
    const seen = commanderIdsByMember.get(link.ashedMemberId);
    return {
      memberId: link.ashedMemberId,
      commanderId: seen && seen.size === 1 ? [...seen][0] : null,
      name: link.memberDisplayName,
      primary: false,
    };
  });
}

async function capture(tx: ActivityTransaction, input: {
  eventKey: ActivityEventKey;
  identity: ActivityIdentity;
  alliance: ActivityAllianceReference | null;
  actingMemberId?: string | null;
  method: ActivityMethod | null;
}): Promise<CapturedActivityContext> {
  const eventKey = input.eventKey;
  const scope = await captureScope(tx, { alliance: input.alliance }, eventKey);
  const actingMemberId =
    input.actingMemberId === undefined || input.actingMemberId === null
      ? null
      : requireIdentifier(input.actingMemberId, eventKey);
  if (actingMemberId !== null && scope.allianceId === null) {
    throw validationFailure(eventKey);
  }
  if (input.identity.kind === "automation" && actingMemberId !== null) {
    throw validationFailure(eventKey);
  }

  let kind: ActivityActor["kind"];
  let channel: ActivityChannel;
  let hqUserId: string | null = null;
  let discordUserId: string | null = null;
  let hqDisplayName: string | null = null;
  let hqAshedUserId: string | null = null;

  if (input.identity.kind === "automation") {
    kind = "automation";
    channel = "automation";
  } else if (input.identity.kind === "web") {
    const captured = await captureWebIdentity(
      tx,
      input.identity.principal,
      eventKey,
    );
    kind = "hq";
    channel = "web";
    hqUserId = captured.hqUserId;
    hqDisplayName = captured.hqDisplayName;
    hqAshedUserId = captured.hqAshedUserId;
  } else if (input.identity.kind === "discord") {
    const captured = await captureDiscordIdentity(
      tx,
      input.identity.discordUserId,
      eventKey,
    );
    kind = "discord";
    channel = "discord";
    hqUserId = captured.hqUserId;
    hqDisplayName = captured.hqDisplayName;
    hqAshedUserId = captured.hqAshedUserId;
    discordUserId = captured.discordUserId;
  } else {
    throw validationFailure(eventKey);
  }

  let hqRole: ActivityRole | null = null;
  let commanderId: string | null = null;
  let gameRank: ActivityActor["gameRank"] = null;
  let selectedCandidate: CommanderCandidate | null = null;
  let selectedRoster: {
    currentName: string;
    allianceRank: number | null;
  } | null = null;

  if (scope.allianceId !== null && kind !== "automation") {
    if (hqUserId !== null) {
      hqRole = await captureHqRole(tx, {
        identity: input.identity,
        hqUserId,
        hqAshedUserId,
        allianceId: scope.allianceId,
      });
    }

    const candidates =
      input.identity.kind === "web" && hqUserId !== null
        ? await captureWebCommanderCandidates(tx, hqUserId, scope.allianceId)
        : input.identity.kind === "discord" && discordUserId !== null
          ? await captureDiscordCommanderCandidates(
              tx,
              discordUserId,
              scope.allianceId,
            )
          : [];

    const memberIds = candidates.map((candidate) => candidate.memberId);
    const rosterRows =
      memberIds.length === 0
        ? []
        : await tx
            .select({
              ashedMemberId: schema.allianceMembers.ashedMemberId,
              currentName: schema.allianceMembers.currentName,
              allianceRank: schema.allianceMembers.allianceRank,
              status: schema.allianceMembers.status,
            })
            .from(schema.allianceMembers)
            .where(
              and(
                eq(schema.allianceMembers.allianceId, scope.allianceId),
                inArray(schema.allianceMembers.ashedMemberId, memberIds),
              ),
            );
    const activeRoster = new Map(
      rosterRows
        .filter((row) => row.status === "active")
        .map((row) => [row.ashedMemberId, row]),
    );
    const eligible = candidates.filter((candidate) =>
      activeRoster.has(candidate.memberId),
    );

    if (actingMemberId !== null) {
      selectedCandidate =
        eligible.find((candidate) => candidate.memberId === actingMemberId) ??
        null;
      if (selectedCandidate === null) {
        throw validationFailure(eventKey);
      }
    } else {
      const primaries = eligible.filter((candidate) => candidate.primary);
      if (primaries.length === 1) {
        selectedCandidate = primaries[0];
      } else if (primaries.length === 0 && eligible.length === 1) {
        selectedCandidate = eligible[0];
      }
    }

    if (selectedCandidate !== null) {
      commanderId = selectedCandidate.commanderId;
      const roster = activeRoster.get(selectedCandidate.memberId) ?? null;
      if (roster !== null) {
        selectedRoster = roster;
        const rank = roster.allianceRank;
        if (
          typeof rank === "number" &&
          Number.isInteger(rank) &&
          rank >= 1 &&
          rank <= 5
        ) {
          gameRank = `R${rank}` as ActivityActor["gameRank"];
        }
      }
    }
  }

  const actor: ActivityActor = {
    kind,
    hqUserId,
    discordUserId,
    personalOwnerHqUserId: hqUserId,
    commanderId,
    displayName:
      safeVisibleName(hqDisplayName) ??
      safeVisibleName(selectedRoster?.currentName ?? null) ??
      safeVisibleName(selectedCandidate?.name ?? null),
    hqRole,
    gameRank,
  };
  const actorParsed = activityActorSchema.safeParse(actor);
  if (!actorParsed.success) {
    throw validationFailure(eventKey);
  }
  const scopeParsed = activityScopeSchema.safeParse(scope);
  if (!scopeParsed.success) {
    throw validationFailure(eventKey);
  }
  return {
    actor: actorParsed.data,
    scope: scopeParsed.data,
    channel,
    method: input.method,
  };
}

export async function captureActivityContext(
  tx: ActivityTransaction,
  input: {
    eventKey: ActivityEventKey;
    identity: ActivityIdentity;
    alliance: ActivityAllianceReference | null;
    actingMemberId?: string | null;
    method: ActivityMethod | null;
  },
): Promise<CapturedActivityContext> {
  try {
    return await capture(tx, input);
  } catch (error) {
    throw toActivityWriteError(error, input.eventKey);
  }
}
