import { NextResponse } from "next/server";

import { parseAdminUsersQueryParams } from "@/lib/rbac/admin-users-query.shared";
import {
  assignManualMembership,
  loadAdminUserById,
  loadAdminUsersMeta,
  searchAdminUsers,
  setPlatformMaintainer,
  updateManualMembershipRole,
  type AdminUserRow,
} from "@/lib/rbac/admin-users";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

function serializeAdminUser(user: AdminUserRow) {
  return {
    ...user,
    createdAt: user.createdAt.toISOString(),
    memberLinks: user.memberLinks.map((link) => ({
      ...link,
      linkedAt: link.linkedAt.toISOString(),
    })),
  };
}

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const params = parseAdminUsersQueryParams(new URL(request.url).searchParams);

  if (params.hqUserId) {
    const user = await loadAdminUserById(params.hqUserId);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    return NextResponse.json({ user: serializeAdminUser(user) });
  }

  const [search, meta] = await Promise.all([
    searchAdminUsers({
      q: params.q,
      page: params.page,
      limit: params.limit,
      allianceId: params.allianceId,
      platformMaintainersOnly: params.platformMaintainersOnly,
    }),
    loadAdminUsersMeta(),
  ]);

  return NextResponse.json({
    users: search.users.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
    })),
    total: search.total,
    page: search.page,
    pageSize: search.pageSize,
    roles: meta.roles,
    alliances: meta.alliances,
  });
}

export async function PATCH(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as {
    hqUserId?: string;
    isPlatformMaintainer?: boolean;
    assignMembership?: {
      allianceId: string;
      roleId: string;
    };
    updateMembership?: {
      membershipId: string;
      roleId: string;
    };
  };

  if (!body.hqUserId) {
    return NextResponse.json({ error: "hqUserId is required." }, { status: 400 });
  }

  try {
    if (body.isPlatformMaintainer !== undefined) {
      await setPlatformMaintainer(body.hqUserId, body.isPlatformMaintainer);
    }

    if (body.assignMembership) {
      await assignManualMembership({
        hqUserId: body.hqUserId,
        allianceId: body.assignMembership.allianceId,
        roleId: body.assignMembership.roleId,
      });
    }

    if (body.updateMembership) {
      await updateManualMembershipRole(
        body.updateMembership.membershipId,
        body.updateMembership.roleId,
      );
    }

    const user = await loadAdminUserById(body.hqUserId);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      user: serializeAdminUser(user),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed." },
      { status: 400 },
    );
  }
}
