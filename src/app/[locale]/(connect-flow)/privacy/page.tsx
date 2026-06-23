import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ashedLink, strongText } from "@/components/i18n/richText";

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });

  return {
    title: t("privacyTitle"),
    description: t("privacyDescription"),
  };
}

export default async function PrivacyPage() {
  const t = await getTranslations("privacy");

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
        <h2 className="text-lg font-medium">{t("noSellTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("noSellBody1", { link: ashedLink, strong: strongText })}
        </p>
        <p className="text-[#8b949e]">{t("noSellBody2")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("whatWeStoreTitle")}</h2>
        <ul className="list-disc space-y-2 pl-5 text-[#8b949e]">
          <li>{t("whatWeStoreItems.session")}</li>
          <li>{t("whatWeStoreItems.token")}</li>
          <li>{t("whatWeStoreItems.metadata")}</li>
          <li>{t("whatWeStoreItems.label")}</li>
        </ul>
        <p className="text-[#8b949e]">{t("whatWeStoreFooter")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("encryptionTitle")}</h2>
        <p className="text-[#8b949e]">{t("encryptionIntro")}</p>
        <ol className="list-decimal space-y-2 pl-5 text-[#8b949e]">
          <li>{t.rich("encryptionSteps.encrypted", { strong: strongText })}</li>
          <li>{t.rich("encryptionSteps.separateKey", { strong: strongText })}</li>
          <li>{t.rich("encryptionSteps.uniqueIv", { strong: strongText })}</li>
          <li>{t.rich("encryptionSteps.serverSide", { strong: strongText })}</li>
          <li>{t.rich("encryptionSteps.disconnect", { strong: strongText })}</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("whereDataTitle")}</h2>
        <p className="text-[#8b949e]">{t("whereDataBody")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("questionsTitle")}</h2>
        <p className="text-[#8b949e]">
          {t.rich("questionsBody", {
            githubLink: (chunks) => (
              <a
                href="https://github.com/amcmillion/alliance-hq"
                target="_blank"
                rel="noreferrer"
                className="text-[#58a6ff] hover:underline"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>
    </article>
  );
}
