import { notFound } from "next/navigation";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";

const VR_PNG = "/api/dev/discord-chart-preview?kind=vr&format=png";
const VR_SVG = "/api/dev/discord-chart-preview?kind=vr&format=svg";
const THP_PNG = "/api/dev/discord-chart-preview?kind=thp&format=png";
const THP_SVG = "/api/dev/discord-chart-preview?kind=thp&format=svg";

/**
 * Standalone developer preview of the PNGs Discord slash commands would post.
 * Uses fixture series via `/api/dev/discord-chart-preview` (dev/preview only).
 */
export default function DiscordChartPreviewPage() {
  if (!isDevOrPreviewEnvironment()) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 text-hq-fg">
      <h1 className="text-2xl font-semibold tracking-tight">
        Discord chart preview
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-hq-fg-muted">
        Fixture PNGs at Discord canvas size (1200×675) — the same shared SVG →{" "}
        <code className="text-hq-fg">sharp</code> pipeline used by{" "}
        <code className="text-hq-fg">/what-is-my-vr-chart</code> and{" "}
        <code className="text-hq-fg">/what-is-my-thp-chart</code>. Pass{" "}
        <code className="text-hq-fg">locale=pt-BR</code> on the API to preview
        localized axis labels. Dev and preview only.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">VR progress</h2>
        <p className="mt-1 font-mono text-xs text-hq-fg-muted">
          {VR_PNG}
          {" · "}
          {VR_SVG}
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- raw API PNG preview */}
        <img
          src={VR_PNG}
          alt="VR progress chart as Discord would attach"
          className="mt-4 w-full max-w-full rounded-lg border border-hq-border bg-[#0d1117]"
          width={1200}
          height={675}
        />
      </section>

      <section className="mt-12">
        <h2 className="text-lg font-medium">THP history</h2>
        <p className="mt-1 font-mono text-xs text-hq-fg-muted">
          {THP_PNG}
          {" · "}
          {THP_SVG}
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- raw API PNG preview */}
        <img
          src={THP_PNG}
          alt="THP history chart as Discord would attach"
          className="mt-4 w-full max-w-full rounded-lg border border-hq-border bg-[#0d1117]"
          width={1200}
          height={675}
        />
      </section>
    </main>
  );
}
