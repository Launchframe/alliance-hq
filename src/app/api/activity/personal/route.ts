import { handleActivityRead } from "@/lib/activity/api.server";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleActivityRead(request, "personal");
}
