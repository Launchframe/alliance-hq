import "server-only";

import { NextResponse } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { ZodError } from "zod";
import { SUPPORT_TEAM_NAME_MAX } from "./policy.shared";
import { SupportError } from "./types.shared";

export async function supportErrorResponse(error: unknown) {
  const t = await getTranslations();
  if (error instanceof SupportError) {
    const key = error.code === "incomplete" ? "supportTeams.proposals.incomplete" : error.code === "forbidden" ? "hotkeys.permissionRequired" : ["notOpen", "proxyEarly"].includes(error.code) ? `supportTeams.draft.${error.code}` : ["dependencies", "invalid", "undone"].includes(error.code) ? `supportTeams.history.${error.code}` : `supportTeams.${error.code}`;
    const time = error.details?.deadline ? new Intl.DateTimeFormat(await getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(error.details.deadline)) : "";
    return NextResponse.json({ code: error.code, error: t(key, { max: SUPPORT_TEAM_NAME_MAX, time }), ...error.details },  { status: error.code === "forbidden" ? 403 : ["nameRequired", "nameLimit"].includes(error.code) ? 400 : 409 });
  }
  if (error instanceof ZodError || error instanceof SyntaxError) return NextResponse.json({ code: "changed", error: t("supportTeams.changed") }, { status: 400 });
  return NextResponse.json({ code: "unavailable", error: t("discordBot.errors.serverError") }, { status: 500 });
}
export function privateJson(value: unknown) {
  return NextResponse.json(value, { headers: { "Cache-Control": "private, no-store" } });
}
