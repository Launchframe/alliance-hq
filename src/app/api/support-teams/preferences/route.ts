import { z } from "zod";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { displayPreferencesSchema } from "@/lib/support-teams/display-preferences.shared";
import { readDisplayPreferences, saveDisplayPreferences } from "@/lib/support-teams/display-preferences.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

const inputSchema = z.object({ expectedVersion: z.number().int().nonnegative(), display: displayPreferencesSchema }).strict();
export async function GET() {
  try { return privateJson(await readDisplayPreferences((await requireSupportAccess()).actor.principalId)); }
  catch (error) { return supportErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const access = await requireSupportAccess();
    const input = inputSchema.parse(await request.json());
    return privateJson(await saveDisplayPreferences(access.actor.principalId, input.expectedVersion, input.display));
  } catch (error) { return supportErrorResponse(error); }
}
