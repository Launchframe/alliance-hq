import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePageSession } from "@/lib/session";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { requirePlanWebActor } from "@/lib/plunder-plan/access.server";
import { loadPlunderPlan } from "@/lib/plunder-plan/service.server";
import { PlunderPlanError } from "@/lib/plunder-plan/types.shared";
import { getServerCalendarDate, getWeekStartMonday, addCalendarDays } from "@/lib/trains/game-time";
import { PlunderPlanCalendarClient } from "@/components/plunder-plan/PlunderPlanCalendarClient";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations("plunderPlan");
  return allianceScopedMetadata(t("title"));
}
export default async function PlunderPlanPage() {
  await requirePageSession("/plunder-plan");
  const actor = await requirePlanWebActor().catch(() => null);
  if (!actor) notFound();
  const today = getServerCalendarDate(), week = getWeekStartMonday(today);
  let initial;
  try {
    initial = await loadPlunderPlan(actor, `${addCalendarDays(week, -2)}T00:00:00Z`, `${addCalendarDays(week, 10)}T00:00:00Z`);
  } catch (error) {
    if (error instanceof PlunderPlanError) notFound();
    throw error;
  }
  return <PlunderPlanCalendarClient key={`${actor.allianceId}:${actor.kind === "web" ? actor.hqUserId : actor.discordUserId}`} initial={initial} initialDate={today} />;
}
