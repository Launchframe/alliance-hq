import type { ReactNode } from "react";

/**
 * Shared branded shell for the public tip-jar landing page (`/b/[code]`).
 * Intentionally theme-independent (dark card on a radial glow) so the
 * short link looks the same whether the visitor's system is light or dark —
 * this is a share-card moment, not app chrome.
 */
export function StoreTipCardShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.16),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(251,191,36,0.08),_transparent_60%)]"
      />
      <div className="relative w-full rounded-3xl border border-slate-700/80 bg-slate-950/80 p-8 text-center shadow-2xl shadow-sky-950/30 backdrop-blur">
        {children}
      </div>
    </main>
  );
}
