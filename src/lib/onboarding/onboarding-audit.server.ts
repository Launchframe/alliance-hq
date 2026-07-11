import "server-only";

import { writeAuditLog } from "@/lib/bff/audit";
import type { MemberLinkOutcome } from "@/lib/member-link/outcome.shared";
import type { MemberLinkRosterSource } from "@/lib/vr/member-roster";

import type { InviteAcceptReasonCode } from "./invite-accept-reasons.shared";

export type MemberLinkSubmitAuditInput = {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  outcome: MemberLinkOutcome;
  rosterSource: MemberLinkRosterSource;
  rosterCount: number;
  ashedMemberId?: string;
};

export async function auditInviteAccepted(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  inviteId: string;
  inviteKind: string;
  roleName: string | null;
}): Promise<void> {
  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: "invite.accepted",
    resourceType: "hq_invite",
    resourceId: input.inviteId,
    metadata: {
      inviteKind: input.inviteKind,
      roleName: input.roleName,
    },
  });
}

export async function auditInviteAcceptFailed(input: {
  sessionId?: string;
  allianceId?: string;
  hqUserId?: string;
  reasonCode: InviteAcceptReasonCode;
  inviteId?: string;
}): Promise<void> {
  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: "invite.accept_failed",
    resourceType: "hq_invite",
    resourceId: input.inviteId,
    metadata: {
      reasonCode: input.reasonCode,
    },
  });
}

export type InviteRevokeKind =
  | "invite_link"
  | "join_code"
  | "commander_claim";

/** Officer deactivated an invite link or join/claim code from team inventory. */
export async function auditInviteRevoked(input: {
  sessionId: string;
  allianceId: string;
  hqUserId: string;
  kind: InviteRevokeKind;
  resourceId: string;
}): Promise<void> {
  const resourceType =
    input.kind === "invite_link" ? "hq_invite" : "hq_alliance_join_code";
  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: "invite.revoked",
    resourceType,
    resourceId: input.resourceId,
    metadata: {
      kind: input.kind,
    },
  });
}

export async function auditMemberLinkSubmit(
  input: MemberLinkSubmitAuditInput,
): Promise<void> {
  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    action: "member_link.submit",
    resourceType: "hq_member_link",
    resourceId: input.ashedMemberId,
    metadata: {
      outcome: input.outcome,
      rosterSource: input.rosterSource,
      rosterCount: input.rosterCount,
      ...(input.ashedMemberId ? { ashedMemberId: input.ashedMemberId } : {}),
    },
  });
}

/** Structured Vercel log line — no email, game UID, or display names. */
export function logMemberLinkSubmitConsole(
  input: MemberLinkSubmitAuditInput,
): void {
  console.info(
    JSON.stringify({
      event: "member_link.submit",
      outcome: input.outcome,
      allianceId: input.allianceId,
      hqUserId: input.hqUserId,
      rosterSource: input.rosterSource,
      rosterCount: input.rosterCount,
      ...(input.ashedMemberId ? { ashedMemberId: input.ashedMemberId } : {}),
    }),
  );
}

export async function recordMemberLinkSubmit(
  input: MemberLinkSubmitAuditInput,
): Promise<void> {
  logMemberLinkSubmitConsole(input);
  await auditMemberLinkSubmit(input);
}
