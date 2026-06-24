import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { loadGuideMarkdown } from "@/lib/guides/load-guide.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Discord train bot — operator guide",
  description:
    "Set up and run Alliance HQ train conductor announcements in Discord.",
};

export default async function DiscordTrainGuidePage() {
  await requirePageSession("/guides/discord-train");
  const markdown = await loadGuideMarkdown("discord-train-operator");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pb-12">
      <ReleaseNoteMarkdown
        markdown={markdown}
        className="prose prose-invert max-w-none prose-headings:text-[#e6edf3] prose-p:text-[#c9d1d9] prose-a:text-[#58a6ff] prose-strong:text-[#e6edf3] prose-li:text-[#c9d1d9] prose-table:text-sm"
      />
    </div>
  );
}
