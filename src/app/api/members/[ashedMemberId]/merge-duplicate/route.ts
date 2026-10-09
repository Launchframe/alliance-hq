import { NextResponse } from "next/server";
import { z } from "zod";

import {
  assertCommanderReadAccess,
  CommanderAccessError,
  resolveCommanderSessionContext,
} from "@/lib/members/commander-access.server";
import {
  allianceHasRosterMember,
  listDuplicateMergeCandidates,
  mergeDuplicateCommander,
  previewDuplicateMerge,
  type MergeDuplicateResult,
} from "@/lib/members/merge-duplicate-commander.server";
import { getRbacContext } from "@/lib/rbac/context";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  duplicateAshedMemberId: z.string().trim().min(1).max(200),
});

type Props = {
  params: Promise<{ ashedMemberId: string }>;
};

const NO_STORE = { "Cache-Control": "private, no-store" };

async function authorize(params: Props["params"]) {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) return sessionOrError;
  const session = sessionOrError;

  const { allianceId, hqUserId } = await resolveCommanderSessionContext(session.id);
  await assertCommanderReadAccess(session.id, allianceId);

  const ctx = await getRbacContext(session.id);
  if (!ctx?.isPlatformMaintainer && !ctx?.permissions.has("members:write")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const keptAshedMemberId = (await params).ashedMemberId.trim();
  if (!keptAshedMemberId) {
    return NextResponse.json({ error: "Member id required." }, { status: 400 });
  }
  if (!(await allianceHasRosterMember(allianceId, keptAshedMemberId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return { session, allianceId, hqUserId, keptAshedMemberId };
}

function resultResponse(result: MergeDuplicateResult) {
  if (!result.ok) {
    return NextResponse.json({ code: result.code }, { status: 422, headers: NO_STORE });
  }
  return NextResponse.json({ summary: result.summary }, { headers: NO_STORE });
}

function errorResponse(error: unknown) {
  if (error instanceof CommanderAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(
    "[merge-duplicate] request failed:",
    error instanceof Error ? error.message : "unknown",
  );
  return NextResponse.json({ code: "generic" }, { status: 500 });
}

/** Candidate list, or a dry-run preview when `?duplicate=` is given. */
export async function GET(request: Request, { params }: Props) {
  try {
    const auth = await authorize(params);
    if (auth instanceof NextResponse) return auth;

    const duplicate = new URL(request.url).searchParams.get("duplicate")?.trim();
    if (duplicate) {
      return resultResponse(
        await previewDuplicateMerge({
          allianceId: auth.allianceId,
          keptAshedMemberId: auth.keptAshedMemberId,
          duplicateAshedMemberId: duplicate,
        }),
      );
    }

    const candidates = await listDuplicateMergeCandidates({
      allianceId: auth.allianceId,
      keptAshedMemberId: auth.keptAshedMemberId,
    });
    return NextResponse.json({ candidates }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Props) {
  try {
    const auth = await authorize(params);
    if (auth instanceof NextResponse) return auth;

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    return resultResponse(
      await mergeDuplicateCommander({
        allianceId: auth.allianceId,
        keptAshedMemberId: auth.keptAshedMemberId,
        duplicateAshedMemberId: body.duplicateAshedMemberId,
        actorHqUserId: auth.hqUserId,
        sessionId: auth.session.id,
      }),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
