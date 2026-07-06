import { Link } from "@/i18n/navigation";
import { ReleaseNoteMarkdown } from "@/components/release-notes/ReleaseNoteMarkdown";
import { loadGuideMarkdown } from "@/lib/guides/load-guide.server";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guides.gettingStarted" });
  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GettingStartedGuidePage() {
  const t = await getTranslations("guides.gettingStarted");
  const markdown = await loadGuideMarkdown("alliance-r5-getting-started");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 pb-12">
      <Link href="/" className="text-sm text-[#58a6ff] hover:underline">
        {t("backToHome")}
      </Link>
      <ReleaseNoteMarkdown
        markdown={markdown}
        className="prose prose-invert max-w-none prose-headings:text-[#e6edf3] prose-p:text-[#c9d1d9] prose-a:text-[#58a6ff] prose-strong:text-[#e6edf3] prose-li:text-[#c9d1d9] prose-table:text-sm"
      />
    </div>
  );
}
