import { redirect } from "next/navigation";

import { AshedShell } from "@/components/ashed-shell/AshedShell";
import { rethrowNavigationError } from "@/lib/navigation";
import { getPageSessionState } from "@/lib/session";

export const dynamic = "force-dynamic";

function isDevDatabaseHint(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message;
  if (msg.includes("LOCAL_DATABASE_URL") || msg.includes("DATABASE_URL")) {
    return "Set LOCAL_DATABASE_URL in .env.local (no ?schema=public — that is Prisma-only).";
  }
  if (msg.includes("TOKEN_ENCRYPTION_KEY")) {
    return "Set TOKEN_ENCRYPTION_KEY in .env.local (openssl rand -hex 32).";
  }
  if (msg.includes('relation "sessions" does not exist')) {
    return "Tables missing — run npm run db:push against your local database.";
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("connect")) {
    return "Cannot reach Postgres — is the server running on localhost:5432?";
  }
  if (process.env.NODE_ENV === "development") {
    return msg;
  }
  return null;
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let state;
  try {
    state = await getPageSessionState();
  } catch (error) {
    rethrowNavigationError(error);
    const hint = isDevDatabaseHint(error);
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d1117] p-6 text-[#e6edf3]">
        <div className="max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 text-center">
          <h1 className="text-lg font-semibold">Database not configured</h1>
          <p className="mt-2 text-sm text-[#8b949e]">
            {hint ?? (
              <>
                Set <code className="text-[#58a6ff]">LOCAL_DATABASE_URL</code> and{" "}
                <code className="text-[#58a6ff]">TOKEN_ENCRYPTION_KEY</code> in{" "}
                <code className="text-[#58a6ff]">.env.local</code>, then run{" "}
                <code className="text-[#58a6ff]">npm run db:push</code>.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (!state.isConnected) {
    redirect("/connect");
  }

  return (
    <AshedShell userLabel={state.userLabel} isConnected={state.isConnected}>
      {children}
    </AshedShell>
  );
}
