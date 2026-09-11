import { z } from "zod";
import { requireSupportAccess } from "@/lib/support-teams/access.server";
import { loadSupportHistory } from "@/lib/support-teams/service.server";
import { privateJson, supportErrorResponse } from "@/lib/support-teams/route-helpers.server";

const filterSchema = z.object({ beforeVersion: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).optional(), actorId: z.string().max(100).optional(), teamId: z.string().max(100).optional(), memberId: z.string().max(100).optional(), kind: z.string().max(40).optional(), contextId: z.string().max(100).optional(), query: z.string().max(200).optional() }).strict();
export async function GET(request: Request) {
  try {
    const access = await requireSupportAccess("read");
    const filter = filterSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return privateJson(await loadSupportHistory(access, filter));
  } catch (error) { return supportErrorResponse(error); }
}
