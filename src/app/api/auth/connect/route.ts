import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";

import {
  collectDatabaseErrorText,
  isMissingSchemaError,
} from "@/lib/db/error-message";
import {
  AllianceSelectionError,
  allianceSelectionErrorStatus,
  resolveConnectAlliance,
} from "@/lib/alliance/connect-alliance";
import {
  emailHasAshedConnectAccess,
  rbacAllowsAshedConnect,
  sessionHasActiveMembership,
} from "@/lib/native-alliance/access";
import { emailHasAshedConnectPermission } from "@/lib/access/invite-gate";
import { verifyBase44Connection } from "@/lib/base44/server";
import {
  AshedConnectAuthMismatchError,
  AshedConnectEmailStubCollisionError,
  assertAshedConnectAuthBinding,
} from "@/lib/auth/session-connect-identity";
import {
  DEFAULT_APP_ID,
  DEFAULT_ORIGIN_URL,
  parseConnectionInput,
} from "@/lib/connectionString";
import { rebindAshedIdentityToSession } from "@/lib/ashed/rebind-session";
import { syncAshedAllianceRoles } from "@/lib/rbac/sync-ashed-roles";
import { maybeBootstrapPlatformMaintainer } from "@/lib/rbac/bootstrap-platform";
import { getRbacContext } from "@/lib/rbac/context";
import {
  getOrCreateSession,
  getSessionState,
  storeAshedConnection,
  updateSessionAlliance,
} from "@/lib/session";

export async function GET() {
  try {
    const locale = await getLocale();
    const state = await getSessionState(locale);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load session",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    const sessionRbac = await getRbacContext(session.id);
    const hasActiveMembership = await sessionHasActiveMembership(session);
    // Bound session: deny if the user's active role lacks ashed:connect
    if (
      sessionRbac &&
      !rbacAllowsAshedConnect(sessionRbac, hasActiveMembership)
    ) {
      return NextResponse.json(
        {
          error:
            "Your invite role does not include Ashed connection access. Ask an admin if this needs to change.",
          code: "connect_not_allowed_for_member",
        },
        { status: 403 },
      );
    }

    const locale = await getLocale();
    const body = (await request.json()) as {
      input?: string;
      appId?: string;
      originUrl?: string;
      expiryReminderDays?: number;
      allianceId?: string;
      allianceTag?: string;
    };

    const parsed = parseConnectionInput(body.input ?? "", {
      appId: body.appId ?? DEFAULT_APP_ID,
      originUrl: body.originUrl ?? DEFAULT_ORIGIN_URL,
    });

    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const me = await verifyBase44Connection(parsed.connection);
    const userLabel =
      me.email ?? me.full_name ?? me.id ?? "Connected user";

    if (!me.email) {
      return NextResponse.json(
        { error: "Ashed account email is required to connect." },
        { status: 502 },
      );
    }

    if (!(await emailHasAshedConnectAccess(me.email))) {
      return NextResponse.json(
        {
          error:
            "Production access requires an admin invite first. Ask your platform maintainer for a link, accept it, then connect Ashed here.",
          code: "invite_required",
        },
        { status: 403 },
      );
    }

    // Unbound-session bypass guard: check the email's member-role membership
    // when getRbacContext returned null (hqUserId not yet set on this session).
    if (!sessionRbac && !(await emailHasAshedConnectPermission(me.email))) {
      return NextResponse.json(
        {
          error:
            "Your invite role does not include Ashed connection access. Ask an admin if this needs to change.",
          code: "connect_not_allowed_for_member",
        },
        { status: 403 },
      );
    }

    const authHqUserId = session.hqUserId;

    await assertAshedConnectAuthBinding({
      authHqUserId,
      ashedUserId: me.id,
      ashedEmail: me.email,
    });

    const selected = await resolveConnectAlliance(
      parsed.connection,
      { email: me.email, id: me.id },
      {
        allianceId: body.allianceId,
        allianceTag: body.allianceTag,
      },
    );

    const ashed = await storeAshedConnection(
      session.id,
      parsed.connection,
      userLabel,
      {
        ashedUserId: me.id ?? null,
        ...(body.expiryReminderDays !== undefined
          ? { expiryReminderDays: body.expiryReminderDays }
          : {}),
        locale,
      },
    );

    const alliance = await updateSessionAlliance(
      session.id,
      parsed.connection,
      selected.tag,
    );

    const rbac = await syncAshedAllianceRoles({
      connection: parsed.connection,
      sessionId: session.id,
      allianceTag: alliance.tag,
      authHqUserId,
      currentUser: {
        id: me.id,
        email: me.email,
        full_name: me.full_name,
      },
    });

    if (me.id) {
      await rebindAshedIdentityToSession({
        ashedUserId: me.id,
        canonicalHqUserId: rbac.hqUserId,
        sessionId: session.id,
        mergedFromHqUserId: rbac.mergedFromHqUserId,
        allianceId: rbac.hqAllianceId,
      });
    }

    const bootstrappedMaintainer = await maybeBootstrapPlatformMaintainer(
      rbac.hqUserId,
      me.email,
    );

    return NextResponse.json({
      ok: true,
      userLabel,
      isConnected: true,
      ashed,
      alliance: {
        id: alliance.id,
        tag: alliance.tag,
        name: alliance.name,
      },
      rbac: {
        roleName: rbac.roleName,
        hqUserId: rbac.hqUserId,
        accessRole: selected.accessRole,
        bootstrappedPlatformMaintainer: bootstrappedMaintainer,
      },
    });
  } catch (error) {
    if (error instanceof AshedConnectAuthMismatchError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 },
      );
    }

    if (error instanceof AshedConnectEmailStubCollisionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 403 },
      );
    }

    if (error instanceof AllianceSelectionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: allianceSelectionErrorStatus(error.code) },
      );
    }

    if (isMissingSchemaError(error)) {
      return NextResponse.json(
        {
          error:
            "Database schema is out of date. Redeploy the app or run npm run db:migrate against production.",
          code: "schema_out_of_date",
          ...(process.env.NODE_ENV === "development"
            ? { detail: collectDatabaseErrorText(error).slice(0, 800) }
            : {}),
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Connection failed. Token may be expired — copy a fresh one from Network.",
      },
      { status: 401 },
    );
  }
}
