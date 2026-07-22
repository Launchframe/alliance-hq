import { notFound } from "next/navigation";

import { BankLifecycleGuideStepPage } from "@/components/guides/BankLifecycleGuideStepPage";
import {
  BANK_LIFECYCLE_GUIDE_STEP_SLUGS,
  isBankLifecycleGuideStepSlug,
  stepSlugToMessageKey,
} from "@/lib/guides/bank-lifecycle-guide.shared";
import { requirePageSession } from "@/lib/session";
import { getTranslations } from "next-intl/server";

type Props = {
  params: Promise<{ locale: string; step: string }>;
};

export function generateStaticParams() {
  return BANK_LIFECYCLE_GUIDE_STEP_SLUGS.map((step) => ({ step }));
}

export async function generateMetadata({ params }: Props) {
  const { locale, step } = await params;
  if (!isBankLifecycleGuideStepSlug(step)) {
    return { title: "Guide" };
  }
  const t = await getTranslations({ locale, namespace: "guides.bankLifecycle" });
  const messageKey = stepSlugToMessageKey(step);
  return {
    title: t(`steps.${messageKey}.title`),
    description: t(`steps.${messageKey}.summary`),
  };
}

export default async function BankLifecycleGuideStepRoute({ params }: Props) {
  const { step } = await params;
  await requirePageSession(`/guides/bank-lifecycle/${step}`);

  if (!isBankLifecycleGuideStepSlug(step)) {
    notFound();
  }

  return (
    <div className="min-w-0">
      <BankLifecycleGuideStepPage stepSlug={step} />
    </div>
  );
}
