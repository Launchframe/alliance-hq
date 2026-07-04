import { getTranslations } from "next-intl/server";

import { PromptStudioForm } from "@/components/trains/prompt-studio/PromptStudioForm";
import { requirePromptStudioPage } from "@/lib/trains/load-prompt-studio.server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("trains.promptStudio");
  return { title: t("title") };
}

export default async function NewPromptTemplatePage() {
  const payload = await requirePromptStudioPage();

  return (
    <div className="px-4 py-6 sm:px-6">
      <PromptStudioForm
        allianceName={payload.alliance.name}
        allianceTag={payload.alliance.tag}
        seasonKey={payload.seasonKey}
        roster={payload.roster}
      />
    </div>
  );
}
