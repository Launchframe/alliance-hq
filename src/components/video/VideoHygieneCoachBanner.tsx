"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { VideoHygieneCoachTipId } from "@/lib/video/video-hygiene-coach.shared";

type CoachTipPayload = {
  tipId: VideoHygieneCoachTipId;
  titleKey: string;
  bodyKey: string;
};

type Props = {
  scoreTarget: string | null;
};

export function VideoHygieneCoachBanner({ scoreTarget }: Props) {
  const t = useTranslations("videoHygieneCoach");
  const [loaded, setLoaded] = useState<{
    scoreTarget: string;
    tip: CoachTipPayload | null;
  } | null>(null);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!scoreTarget) return;
    const target = scoreTarget;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/tools/video-hygiene/coach?scoreTarget=${encodeURIComponent(target)}`,
        );
        if (!res.ok) {
          if (!cancelled) setLoaded({ scoreTarget: target, tip: null });
          return;
        }
        const data = (await res.json()) as { tip: CoachTipPayload | null };
        if (cancelled) return;
        setLoaded({ scoreTarget: target, tip: data.tip ?? null });
        if (data.tip) {
          void fetch("/api/tools/video-hygiene/coach", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "shown",
              tipId: data.tip.tipId,
              scoreTarget: target,
            }),
          });
        }
      } catch {
        if (!cancelled) setLoaded({ scoreTarget: target, tip: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scoreTarget]);

  const tip =
    scoreTarget && loaded?.scoreTarget === scoreTarget ? loaded.tip : null;

  if (!tip) return null;

  async function onDismiss() {
    if (!scoreTarget || !tip) return;
    setDismissing(true);
    try {
      await fetch("/api/tools/video-hygiene/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dismiss",
          tipId: tip.tipId,
          scoreTarget,
        }),
      });
      setLoaded({ scoreTarget, tip: null });
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div
      className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-foreground"
      role="status"
    >
      <p className="font-medium">{t(tip.titleKey)}</p>
      <p className="mt-1 text-muted-foreground">{t(tip.bodyKey)}</p>
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={dismissing}
          onClick={() => void onDismiss()}
        >
          {t("dismiss")}
        </Button>
      </div>
    </div>
  );
}
