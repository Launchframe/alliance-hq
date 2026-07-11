import type { RbacContext } from "@/lib/rbac/context";

export type DataBatchContext = {
  eventId?: string;
  team?: "A" | "B";
  boardKey?: string;
  hqEventId?: string;
  commendationId?: string;
};

export type DataBatchRow = {
  id: string;
  allianceId: string;
  scoreTarget: string;
  submitEntity: string;
  recordedDate: string;
  contextJson: DataBatchContext;
  rowCount: number;
  sourceJobId: string | null;
  parseSessionId: string | null;
  createdByHqUserId: string | null;
  submittedAt: string;
  status: string;
  movedToDate: string | null;
  deletedAt: string | null;
};

const ALLIANCE_ADMIN_ROLES = new Set(["owner", "maintainer"]);

export function canViewDataManagement(permissions: ReadonlySet<string>): boolean {
  return permissions.has("data:read");
}

export function canManageAnyDataBatch(ctx: Pick<RbacContext, "roleName" | "permissions">): boolean {
  if (ctx.permissions.has("alliance:admin")) {
    return true;
  }
  return ctx.roleName != null && ALLIANCE_ADMIN_ROLES.has(ctx.roleName);
}

export function canManageDataBatch(
  ctx: Pick<RbacContext, "hqUserId" | "roleName" | "permissions">,
  batch: Pick<DataBatchRow, "createdByHqUserId">,
): boolean {
  if (canManageAnyDataBatch(ctx)) {
    return true;
  }
  if (ctx.roleName !== "officer" || !ctx.hqUserId || !batch.createdByHqUserId) {
    return false;
  }
  return batch.createdByHqUserId === ctx.hqUserId;
}

export function batchActionFlags(
  ctx: Pick<RbacContext, "hqUserId" | "roleName" | "permissions">,
  batch: Pick<DataBatchRow, "createdByHqUserId" | "status">,
): { canMove: boolean; canDelete: boolean } {
  if (batch.status !== "active") {
    return { canMove: false, canDelete: false };
  }
  const allowed = canManageDataBatch(ctx, batch);
  return { canMove: allowed, canDelete: allowed };
}
