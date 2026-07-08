import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { ashedLink, strongText } from "@/components/i18n/richText";
import { Link } from "@/i18n/navigation";

const GITHUB_URL = "https://github.com/Launchframe/alliance-hq";

const FEATURE_KEYS = [
  "featureRoster",
  "featureTrains",
  "featureVrDiscord",
  "featureInvites",
  "featureVideo",
] as const;

const HOW_TO_KEYS = ["howStepSignIn", "howStepAccess", "howStepUse"] as const;

export async function LandingPage() {
  const t = await getTranslations("landing");

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <header className="space-y-4 text-center">
        <div className="flex justify-center">
          <Image
            src="/brand/hq-icon-mark.svg"
            alt=""
            width={64}
            height={64}
            priority
          />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-lg text-hq-fg-muted">{t("tagline")}</p>
      </header>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Link
          href="/auth"
          className="w-full rounded-lg border border-hq-success bg-hq-success px-6 py-3 text-center text-sm font-medium text-white sm:w-auto"
        >
          {t("signInCta")}
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="w-full rounded-lg border border-hq-border px-6 py-3 text-center text-sm text-hq-fg-muted transition-colors hover:border-[#484f58] hover:text-hq-fg sm:w-auto"
        >
          {t("githubCta")}
        </a>
      </div>

      <p className="text-center text-xs text-hq-fg-subtle">{t("signupHint")}</p>

      <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-6">
        <h2 className="text-lg font-medium">{t("purposeTitle")}</h2>
        <p className="text-sm leading-relaxed text-hq-fg-muted">
          {t.rich("purposeBody", { link: ashedLink, strong: strongText })}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-6">
        <h2 className="text-lg font-medium">{t("featuresTitle")}</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-hq-fg-muted">
          {FEATURE_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-hq-border bg-hq-surface p-6">
        <h2 className="text-lg font-medium">{t("howTitle")}</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-hq-fg-muted">
          {HOW_TO_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}
