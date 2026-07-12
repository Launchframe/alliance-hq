import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { loadGuideMarkdown } from "@/lib/guides/load-guide.server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Video pipeline configs and experiments",
  description:
    "Platform guide for frame extraction parse configs, OCR knobs, and score-target experiments.",
};

/**
 * Platform-maintainer guide (English-only markdown). Admin layout already
 * requires hq:admin — no separate session gate here.
 */
export default async function AdminVideoPipelineGuidePage() {
  const markdown = await loadGuideMarkdown("video-pipeline-configs");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pb-12">
      <ReleaseNoteMarkdown
        markdown={markdown}
        className="prose prose-invert max-w-none prose-headings:text-hq-fg prose-p:text-[#c9d1d9] prose-a:text-hq-accent prose-strong:text-hq-fg prose-li:text-[#c9d1d9] prose-table:text-sm"
      />
    </div>
  );
}
