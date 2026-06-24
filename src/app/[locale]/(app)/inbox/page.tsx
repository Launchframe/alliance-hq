import { requirePageSession } from "@/lib/session";

import InboxPageClient from "./InboxPageClient";

export const dynamic = "force-dynamic";

export default async function InboxRoutePage() {
  await requirePageSession("/inbox");
  return <InboxPageClient />;
}
