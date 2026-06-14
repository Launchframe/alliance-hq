import { NextResponse } from "next/server";

import {
  assignManualMembership,
  loadAdminUsersDirectory,
  setPlatformMaintainer,
  updateManualMembershipRole,
} from "@/lib/rbac/admin-users";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const directory = await loadAdminUsersDirectory();
  return NextResponse.json({
    users: directory.users.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
    })),
    roles: directory.roles,
    alliances: directory.alliances,
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

    const directory = await loadAdminUsersDirectory();
    const user = directory.users.find((row) => row.id === body.hqUserId);
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      user: {
        ...user,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed." },
      { status: 400 },
    );
  }
}
