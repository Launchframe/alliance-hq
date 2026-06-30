import { Link } from "@/i18n/navigation";
import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { loadGuideMarkdown } from "@/lib/guides/load-guide.server";
import { requirePageSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fresh native alliance — onboarding",
  description:
    "Onboard a native alliance from owner-only to a fully linked roster on HQ.",
};

export default async function FreshNativeAllianceOnboardingGuidePage() {
  await requirePageSession("/guides/alliance-onboarding/fresh-native");
  const markdown = await loadGuideMarkdown("fresh-native-alliance-onboarding");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pb-12">
      <Link
        href="/guides/alliance-onboarding"
        className="text-sm text-[#58a6ff] hover:underline"
      >
        ← Alliance onboarding
      </Link>
      <ReleaseNoteMarkdown
        markdown={markdown}
        className="prose prose-invert max-w-none prose-headings:text-[#e6edf3] prose-p:text-[#c9d1d9] prose-a:text-[#58a6ff] prose-strong:text-[#e6edf3] prose-li:text-[#c9d1d9] prose-table:text-sm"
      />
    </div>
  );
}
