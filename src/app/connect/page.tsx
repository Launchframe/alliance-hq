import { redirect } from "next/navigation";

import { ConnectionWalkthrough } from "@/components/ConnectionWalkthrough";
import { rethrowNavigationError } from "@/lib/navigation";
import { getAshedConnection, requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  try {
    const session = await requirePageSession("/connect");
    const connected = await getAshedConnection(session.id);
    if (connected) {
      redirect("/");
    }
  } catch (error) {
    rethrowNavigationError(error);
    // DB not ready — still show walkthrough; connect API will surface errors
  }

  return (
    <div className="min-h-screen bg-[#0d1117] px-4 py-10 text-[#e6edf3]">
      <ConnectionWalkthrough />
    </div>
  );
}
