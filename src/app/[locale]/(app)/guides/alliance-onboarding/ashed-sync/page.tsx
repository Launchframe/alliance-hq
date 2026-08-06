import { Link } from "@/i18n/navigation";
import { allianceScopedMetadata } from "@/lib/metadata/generate-page-metadata.server";
import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { loadGuideMarkdown } from "@/lib/guides/load-guide.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const meta = allianceScopedMetadata("Ashed-sync alliance — member onboarding");
  return { ...meta, description: "Link HQ accounts to roster members when your alliance syncs from Ashed." };
}

export default async function AshedSyncAllianceOnboardingGuidePage() {
  await requirePageSession("/guides/alliance-onboarding/ashed-sync");
  const markdown = await loadGuideMarkdown("ashed-alliance-member-onboarding");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pb-12">
      <Link
        href="/guides/alliance-onboarding"
        className="text-sm text-hq-accent hover:underline"
      >
        ← Alliance onboarding
      </Link>
      <ReleaseNoteMarkdown
        markdown={markdown}
        className="prose prose-invert max-w-none prose-headings:text-hq-fg prose-p:text-[#c9d1d9] prose-a:text-hq-accent prose-strong:text-hq-fg prose-li:text-[#c9d1d9] prose-table:text-sm"
      />
    </div>
  );
}
