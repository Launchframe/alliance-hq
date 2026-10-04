"use client";

import { useTranslations } from "next-intl";

import {
  isVrTopScopeUnlocked,
  vrReportersRequiredForTopN,
  type ConductorTopN,
} from "@/lib/trains/conductor-top-n.shared";
import {
  VR_TOP_N_SCOPES,
  VS_TOP_N_SCOPES,
} from "@/lib/trains/rules/catalog.shared";

type Props = {
  /** Which board the scope belongs to. */
  board: "vs_top_n" | "vr_top_n";
  vrReporterCount: number;
  onSelect: (topN: ConductorTopN) => void;
  onBack?: () => void;
};

export function TopNScopePicker({
  board,
  vrReporterCount,
  onSelect,
  onBack,
}: Props) {
  const t = useTranslations("trains.topNScope");
  const kind = board === "vr_top_n" ? "vr" : "vs";
  const scopes: readonly ConductorTopN[] =
    kind === "vr" ? VR_TOP_N_SCOPES : VS_TOP_N_SCOPES;

  return (
    <div className="flex flex-col" data-testid="trains-topn-scope-picker">
      <div className="flex items-center gap-2 border-b border-hq-border px-3 py-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-cyan-400 hover:text-cyan-300"
            data-testid="trains-topn-scope-back"
          >
            {t("back")}
          </button>
        ) : null}
        <p className="text-xs font-medium text-hq-fg">
          {kind === "vs" ? t("titleVs") : t("titleVr")}
        </p>
      </div>
      <div className="py-1">
        {scopes.map((topN) => {
          const locked =
            kind === "vr" && !isVrTopScopeUnlocked(topN, vrReporterCount);
          const required = vrReportersRequiredForTopN(topN);
          return (
            <button
              key={topN}
              type="button"
              role="menuitem"
              disabled={locked}
              data-testid={`trains-topn-scope-${kind}-${topN}`}
              onClick={() => {
                if (!locked) onSelect(topN);
              }}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm ${
                locked
                  ? "cursor-not-allowed text-hq-fg-muted opacity-60"
                  : "text-hq-fg hover:bg-hq-canvas"
              }`}
            >
              <span className="font-medium">
                {t("scopeLabel", { count: topN })}
              </span>
              {locked ? (
                <span className="text-[10px] text-hq-fg-muted">
                  {t("vrLocked", {
                    required,
                    have: vrReporterCount,
                    count: topN,
                  })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
