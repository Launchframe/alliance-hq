import { Link } from "@/i18n/navigation";
import { requirePageSession } from "@/lib/session";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Alliance onboarding — help",
  description:
    "How to invite and link members for Ashed-sync and fresh native alliances.",
};

export default async function AllianceOnboardingGuideHubPage() {
  await requirePageSession("/guides/alliance-onboarding");
  const tGettingStarted = await getTranslations("guides.gettingStarted");

  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8 pb-12">
      <header className="space-y-2">
        <Link
          href="/guides/getting-started"
          className="text-sm text-hq-accent hover:underline"
        >
          ← {tGettingStarted("title")}
        </Link>
        <h1 className="text-2xl font-semibold text-hq-fg">
          Alliance onboarding
        </h1>
        <p className="text-sm text-hq-fg-muted">
          Two paths for getting your alliance onto HQ: pick the one that matches
          how your roster started.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/guides/alliance-onboarding/ashed-sync"
          className="rounded-2xl border border-hq-border bg-hq-canvas p-5 transition-colors hover:border-[#388bfd]/40"
        >
          <h2 className="text-lg font-semibold text-hq-fg">
            Ashed-sync alliance
          </h2>
          <p className="mt-2 text-sm text-hq-fg-muted">
            Roster already imported from Ashed. Officers distribute commander
            claim invites so each member links to the right roster row — names
            may not match in-game until refresh.
          </p>
          <p className="mt-3 text-sm text-hq-accent">Open guide →</p>
        </Link>

        <Link
          href="/guides/alliance-onboarding/fresh-native"
          className="rounded-2xl border border-hq-border bg-hq-canvas p-5 transition-colors hover:border-[#388bfd]/40"
        >
          <h2 className="text-lg font-semibold text-hq-fg">
            Fresh native alliance
          </h2>
          <p className="mt-2 text-sm text-hq-fg-muted">
            No Ashed roster yet — owner is the only HQ user at first. How to link
            yourself, invite officers, grow the roster, and claim-invite everyone
            else.
          </p>
          <p className="mt-3 text-sm text-hq-accent">Open guide →</p>
        </Link>
      </div>
    </div>
  );
}
