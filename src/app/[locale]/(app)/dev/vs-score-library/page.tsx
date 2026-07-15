import { redirect } from "next/navigation";

import { isDevOrPreviewEnvironment } from "@/lib/dev/env-guard";
import { requireAuthForPage } from "@/lib/auth/page-guard";
import { VsScoreLibraryClient } from "@/components/video/VsScoreLibraryClient";

export const dynamic = "force-dynamic";

export default async function VsScoreLibraryPage() {
  if (!isDevOrPreviewEnvironment()) {
    redirect("/");
  }
  await requireAuthForPage("/dev/vs-score-library");

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">VS Score Fixture Library</h1>
        <p className="mt-1 text-sm text-hq-fg-muted">
          Scrape real Ashed VS scores (read-only), save named templates, and use
          them in the video upload wizard for dev/QA.
        </p>
      </div>
      <VsScoreLibraryClient />
    </div>
  );
}
