"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ROUTES } from "@/lib/nav/routes";
import type { AshedConnectionMeta } from "@/lib/jwt/connection-meta";
import { TokenExpiryBanner } from "@/components/TokenExpiryNotice";

type Props = {
  userLabel: string | null;
  isConnected: boolean;
  ashed: AshedConnectionMeta | null;
  children: React.ReactNode;
};

export function AshedShell({ userLabel, isConnected, ashed, children }: Props) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#0d1117] text-[#e6edf3]">
      <aside className="flex w-56 shrink-0 flex-col border-r border-[#30363d] bg-[#161b22]">
        <div className="border-b border-[#30363d] px-4 py-4">
          <Link href="/" className="block">
            <span className="text-lg font-semibold tracking-tight">
              Alliance HQ
            </span>
            <span className="mt-0.5 block text-xs text-[#8b949e]">
              alliance-hq.online
            </span>
          </Link>
        </div>

        <nav className="flex-1 space-y-0.5 p-2">
          {NAV_ROUTES.map((route) => {
            if (route.kind === "external") {
              return (
                <a
                  key={route.href}
                  href={route.externalUrl ?? route.href}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg px-3 py-2 text-sm text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
                >
                  {route.label} ↗
                </a>
              );
            }

            const active =
              route.href === "/"
                ? pathname === "/"
                : pathname.startsWith(route.href);

            return (
              <Link
                key={route.href}
                href={route.href}
                className={`block rounded-lg px-3 py-2 text-sm ${
                  active
                    ? "bg-[#1f3d5c] font-medium text-[#58a6ff]"
                    : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
                }`}
              >
                {route.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#30363d] p-3 text-xs text-[#8b949e]">
          <p>
            Data powered by{" "}
            <a
              href="https://ashed.online"
              target="_blank"
              rel="noreferrer"
              className="text-[#58a6ff] hover:underline"
            >
              Ashed
            </a>
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[#30363d] bg-[#161b22] px-6 py-3">
          <div className="text-sm text-[#8b949e]">
            {isConnected ? (
              <>
                Connected as{" "}
                <span className="font-medium text-[#3fb950]">
                  {userLabel ?? "Ashed user"}
                </span>
              </>
            ) : (
              <Link href="/connect" className="text-[#58a6ff] hover:underline">
                Connect your Ashed account →
              </Link>
            )}
          </div>
        </header>

        {ashed && <TokenExpiryBanner ashed={ashed} />}

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
