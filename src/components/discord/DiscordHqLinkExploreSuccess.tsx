"use client";

import { Link } from "@/i18n/navigation";

export function DiscordHqLinkExploreSuccess({
  labels,
}: {
  labels: {
    successHeading: string;
    successBody: string;
    exploreCta: string;
    exploreDismiss: string;
    exploreHref: string;
  };
}) {
  return (
    <div className="w-full max-w-md space-y-4 rounded-xl border border-green-700 bg-green-950/40 p-6 text-center">
      <p className="text-lg font-semibold text-green-300">{labels.successHeading}</p>
      <p className="whitespace-pre-line text-sm text-green-200">{labels.successBody}</p>
      <Link
        href={labels.exploreHref}
        className="inline-block rounded-lg border border-hq-success bg-hq-success px-4 py-2 text-sm font-medium text-white hover:bg-hq-success-hover"
      >
        {labels.exploreCta}
      </Link>
      <p className="text-xs text-green-200/80">{labels.exploreDismiss}</p>
    </div>
  );
}
