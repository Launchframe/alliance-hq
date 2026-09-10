import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { requirePlanWebActor } from "@/lib/plunder-plan/access.server";
import { loadPlunderPlan, mutatePlunderPlan } from "@/lib/plunder-plan/service.server";
import { PlunderPlanError } from "@/lib/plunder-plan/types.shared";
import { PlanScheduleError } from "@/lib/plunder-plan/schedule.shared";

export const dynamic = "force-dynamic";

async function failure(error: unknown) {
  const t = await getTranslations("plunderPlan");
  const code = error instanceof PlunderPlanError || error instanceof PlanScheduleError ? error.code : "save";
  const status = error instanceof PlunderPlanError ? error.status : error instanceof PlanScheduleError ? 400 : 500;
  return NextResponse.json({ code, error: t(`errors.${code}`) }, { status });
}

export async function GET(request: Request) {
  try {
    const actor = await requirePlanWebActor();
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? new Date().toISOString();
    const until = url.searchParams.get("until") ?? new Date(Date.now() + 8 * 86_400_000).toISOString();
    return NextResponse.json(await loadPlunderPlan(actor, from, until));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requirePlanWebActor();
    const text = await request.text();
    if (text.length > 16_384) throw new PlunderPlanError("invalidSchedule", 413);
    let command: unknown;
    try { command = JSON.parse(text); } catch { throw new PlunderPlanError("invalidSchedule"); }
    return NextResponse.json(await mutatePlunderPlan(actor, command));
  } catch (error) { return failure(error); }
}
