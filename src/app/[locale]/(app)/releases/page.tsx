import { getTranslations } from "next-intl/server";

import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { loadReleaseNotesFromEdgeConfig } from "@/lib/release-notes/edge-config";
import { compareAppVersions } from "@/lib/release-notes/version";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("releaseNotes");
  return { title: t("pageTitle") };
}

export default async function ReleasesPage() {
  await requirePageSession("/releases");
  const t = await getTranslations("releaseNotes");
  const entries = [...(await loadReleaseNotesFromEdgeConfig())].sort((a, b) =>
    compareAppVersions(b.version, a.version),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-hq-fg">{t("pageTitle")}</h1>
        <p className="text-sm text-hq-fg-muted">{t("pageDescription")}</p>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-hq-fg-muted">{t("emptyHistory")}</p>
      ) : (
        <article className="space-y-10 rounded-xl border border-hq-border bg-hq-surface p-5 sm:p-6">
          {entries.map((entry, index) => (
            <section
              key={entry.version}
              className={
                index < entries.length - 1
                  ? "border-b border-hq-border pb-8"
                  : undefined
              }
            >
              <header className="mb-4 space-y-1">
                <h2 className="text-lg font-semibold text-hq-fg">
                  {entry.title}
                </h2>
                <p className="text-xs text-hq-fg-muted">
                  v{entry.version}
                  {entry.shippedAt ? ` · ${entry.shippedAt.slice(0, 10)}` : ""}
                </p>
              </header>
              <ReleaseNoteMarkdown markdown={entry.bodyMarkdown} />
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
