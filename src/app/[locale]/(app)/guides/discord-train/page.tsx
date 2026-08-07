import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { loadGuideMarkdown } from "@/lib/guides/load-guide.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const meta = allianceScopedMetadata("Discord train bot — operator guide");
  return { ...meta, description: "Set up and run Alliance HQ train conductor announcements in Discord." };
}

export default async function DiscordTrainGuidePage() {
  await requirePageSession("/guides/discord-train");
  const markdown = await loadGuideMarkdown("discord-train-operator");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pb-12">
      <ReleaseNoteMarkdown
        markdown={markdown}
        className="prose prose-invert max-w-none prose-headings:text-hq-fg prose-p:text-[#c9d1d9] prose-a:text-hq-accent prose-strong:text-hq-fg prose-li:text-[#c9d1d9] prose-table:text-sm"
      />
    </div>
  );
}
