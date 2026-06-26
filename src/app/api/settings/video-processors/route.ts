import { NextResponse } from "next/server";

import { requireAllianceAdmin } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import {
  MAX_VIDEO_PROCESSORS,
  grantVideoProcessor,
  listAllianceVideoProcessors,
  listVideoProcessorCandidates,
  revokeVideoProcessor,
} from "@/lib/video/processor-slots.server";

export const dynamic = "force-dynamic";

async function resolveAdminAlliance(): Promise<
  | { ok: true; sessionId: string; hqUserId: string | null; allianceId: string }
  | { ok: false; response: NextResponse }
> {
  const session = await getOrCreateSession();
  const denied = await requireAllianceAdmin(session.id);
  if (denied) {
    return { ok: false, response: denied };
  }
  if (!session.currentAllianceId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Alliance context required." },
        { status: 400 },
      ),
    };
  }
  return {
    ok: true,
    sessionId: session.id,
    hqUserId: session.hqUserId,
    allianceId: session.currentAllianceId,
  };
}

export async function GET() {
  const ctx = await resolveAdminAlliance();
  if (!ctx.ok) return ctx.response;

  const [processors, candidates] = await Promise.all([
    listAllianceVideoProcessors(ctx.allianceId),
    listVideoProcessorCandidates(ctx.allianceId),
  ]);

  const processorIds = new Set(processors.map((p) => p.hqUserId));
  return NextResponse.json({
    processors,
    candidates: candidates.filter((c) => !processorIds.has(c.hqUserId)),
    max: MAX_VIDEO_PROCESSORS,
  });
}

type PostBody = { hqUserId?: string };

export async function POST(request: Request) {
  const ctx = await resolveAdminAlliance();
  if (!ctx.ok) return ctx.response;

  let hqUserId: string | undefined;
  try {
    const body = (await request.json()) as PostBody;
    hqUserId = body.hqUserId?.trim();
  } catch {
    hqUserId = undefined;
  }

  if (!hqUserId) {
    return NextResponse.json({ error: "hqUserId is required." }, { status: 400 });
  }

  const candidates = await listVideoProcessorCandidates(ctx.allianceId);
  if (!candidates.some((c) => c.hqUserId === hqUserId)) {
    return NextResponse.json(
      { error: "User is not an eligible processor." },
      { status: 400 },
    );
  }

  const result = await grantVideoProcessor({
    allianceId: ctx.allianceId,
    hqUserId,
    grantedByHqUserId: ctx.hqUserId,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Processor slots are full.", code: "slots_full" },
      { status: 409 },
    );
  }

  const processors = await listAllianceVideoProcessors(ctx.allianceId);
  return NextResponse.json({ ok: true, processors });
}

export async function DELETE(request: Request) {
  const ctx = await resolveAdminAlliance();
  if (!ctx.ok) return ctx.response;

  const url = new URL(request.url);
  const hqUserId = url.searchParams.get("hqUserId")?.trim();
  if (!hqUserId) {
    return NextResponse.json({ error: "hqUserId is required." }, { status: 400 });
  }

  await revokeVideoProcessor({ allianceId: ctx.allianceId, hqUserId });
  const processors = await listAllianceVideoProcessors(ctx.allianceId);
  return NextResponse.json({ ok: true, processors });
}
