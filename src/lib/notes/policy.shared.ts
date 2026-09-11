export type KnowledgeResourceKind = "note" | "task" | "source" | "collection" | "board";
export type KnowledgeOwnershipState = "hq" | "discord" | "unresolved";
export type KnowledgeAccess = "read" | "edit" | "share";

export type KnowledgeActor = {
  kind: "web" | "discord";
  allianceId: string;
  hqUserId: string | null;
  discordUserId: string | null;
  isOfficer: boolean;
  readableBoardIds: readonly string[];
  editableBoardIds: readonly string[];
};

export type KnowledgeResourceAccess = {
  id: string;
  allianceId: string;
  kind: KnowledgeResourceKind;
  ownershipState: KnowledgeOwnershipState;
  ownerHqUserId: string | null;
  ownerDiscordUserId: string | null;
};

export type KnowledgeGrant = {
  resourceId: string;
  allianceId: string;
  subjectKind: "user" | "officers" | "board";
  subjectId: string;
  role: "read" | "edit";
};

export function knowledgeActorIsAuthenticated(actor: KnowledgeActor): boolean {
  return Boolean(actor.allianceId && ((actor.kind === "web" && actor.hqUserId) || (actor.kind === "discord" && actor.discordUserId)));
}

export function knowledgeResourceHasOwner(resource: KnowledgeResourceAccess): boolean {
  return resource.ownershipState === "hq" ? Boolean(resource.ownerHqUserId)
    : resource.ownershipState === "discord" && Boolean(resource.ownerDiscordUserId);
}

export function knowledgeActorOwnsResource(actor: KnowledgeActor, resource: KnowledgeResourceAccess): boolean {
  if (!knowledgeActorIsAuthenticated(actor) || resource.allianceId !== actor.allianceId || !knowledgeResourceHasOwner(resource)) return false;
  if (resource.kind === "board" && (actor.kind !== "web" || !actor.isOfficer)) return false;
  return resource.ownershipState === "hq"
    ? resource.ownerHqUserId === actor.hqUserId
    : actor.kind === "discord" && resource.ownerDiscordUserId === actor.discordUserId;
}

export function canAccessKnowledgeResource(
  actor: KnowledgeActor,
  resource: KnowledgeResourceAccess,
  grants: readonly KnowledgeGrant[],
  access: KnowledgeAccess,
): boolean {
  if (!knowledgeActorIsAuthenticated(actor) || resource.allianceId !== actor.allianceId || !knowledgeResourceHasOwner(resource)) return false;
  if (resource.kind === "board" && (actor.kind !== "web" || !actor.isOfficer)) return false;
  if (knowledgeActorOwnsResource(actor, resource)) return true;
  if (access === "share") return false;
  return grants.some((grant) => {
    if (grant.resourceId !== resource.id || grant.allianceId !== resource.allianceId || (access === "edit" && grant.role !== "edit")) return false;
    if (grant.subjectKind === "user") return Boolean(actor.hqUserId && grant.subjectId === actor.hqUserId);
    if (actor.kind !== "web" || !actor.isOfficer) return false;
    if (grant.subjectKind === "officers") return grant.subjectId === actor.allianceId;
    return grant.subjectKind === "board" && (access === "edit" ? actor.editableBoardIds : actor.readableBoardIds).includes(grant.subjectId);
  });
}
