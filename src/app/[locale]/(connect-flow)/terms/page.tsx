import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ashedLink, strongText } from "@/components/i18n/richText";

const GITHUB_REPO_URL = "https://github.com/amcmillion/alliance-hq";
const LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`;

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("termsTitle"),
    description: t("termsDescription"),
  };
}

function githubLink(chunks: ReactNode) {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className="text-[#58a6ff] hover:underline"
    >
      {chunks}
    </a>
  );
}

function licenseLink(chunks: ReactNode) {
  return (
    <a
      href={LICENSE_URL}
      target="_blank"
      rel="noreferrer"
      className="text-[#58a6ff] hover:underline"
    >
      {chunks}
    </a>
  );
}

export default async function TermsPage() {
  const t = await getTranslations("terms");

  return (
    <article className="mx-auto max-w-2xl space-y-8 text-sm leading-relaxed">
      <header>
        <p className="text-xs text-[#8b949e]">
          <Link href="/" className="text-[#58a6ff] hover:underline">
            {t("backToHome")}
          </Link>
        </p>
        <h1 className="mt-4 text-2xl font-semibold">{t("title")}</h1>
        <p className="mt-2 text-[#8b949e]">{t("intro")}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("acceptableUseTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("acceptableUseBody1", { link: ashedLink })}
        </p>
        <ul className="list-disc space-y-2 pl-5 text-[#8b949e]">
          <li>{t("acceptableUseItems.noAbuse")}</li>
          <li>{t("acceptableUseItems.noHarm")}</li>
          <li>{t("acceptableUseItems.noMisuse")}</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("enforcementTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("enforcementBody", { strong: strongText })}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("openSourceTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("openSourceBody1", { strong: strongText })}
        </p>
        <p className="text-[#8b949e]">
          {t.rich("openSourceBody2", {
            licenseLink,
            githubLink,
          })}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("disclaimerTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("disclaimerBody", { strong: strongText })}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("changesTitle")}</h2>
        <p className="text-[#8b949e]">{t("changesBody")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("questionsTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("questionsBody", { githubLink })}
        </p>
      </section>
    </article>
  );
}
