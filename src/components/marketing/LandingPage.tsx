import Image from "next/image";
import { getTranslations } from "next-intl/server";

import { ashedLink, strongText } from "@/components/i18n/richText";
import { Link } from "@/i18n/navigation";

const GITHUB_URL = "https://github.com/amcmillion/alliance-hq";

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
        <p className="text-lg text-[#8b949e]">{t("tagline")}</p>
      </header>

      <section className="space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h2 className="text-lg font-medium">{t("purposeTitle")}</h2>
        <p className="text-sm leading-relaxed text-[#8b949e]">
          {t.rich("purposeBody", { link: ashedLink, strong: strongText })}
        </p>
      </section>

      <section className="space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h2 className="text-lg font-medium">{t("featuresTitle")}</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-[#8b949e]">
          {FEATURE_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h2 className="text-lg font-medium">{t("howTitle")}</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[#8b949e]">
          {HOW_TO_KEYS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <Link
          href="/auth"
          className="w-full rounded-lg border border-[#238636] bg-[#238636] px-6 py-3 text-center text-sm font-medium text-white sm:w-auto"
        >
          {t("signInCta")}
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="w-full rounded-lg border border-[#30363d] px-6 py-3 text-center text-sm text-[#8b949e] transition-colors hover:border-[#484f58] hover:text-[#e6edf3] sm:w-auto"
        >
          {t("githubCta")}
        </a>
      </div>

      <p className="text-center text-xs text-[#6e7681]">{t("signupHint")}</p>
    </div>
  );
}
