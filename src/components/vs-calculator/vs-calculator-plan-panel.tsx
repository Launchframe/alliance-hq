"use client";

import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { nanoid } from "nanoid";

import { formatVsPoints } from "@/lib/vs-calculator/capacity.shared";
import {
  MAX_HERO_DAY_CANDIDATES,
} from "@/lib/vs-calculator/planner/push-profile.shared";
import type {
  HeroDayCandidate,
  HeroDayPushProfilePayload,
  HeroDaySpendMode,
  HeroSkillTier,
  PlannerAction,
} from "@/lib/vs-calculator/planner/planner-types.shared";
import { DEFAULT_HERO_DAY_RATES } from "@/lib/vs-calculator/planner/planner-types.shared";
import { solveHeroDayPlanner } from "@/lib/vs-calculator/planner/hero-day-planner.shared";
import type {
  VsCalculatorPayload,
  VsCalculatorPlannerPayload,
} from "@/lib/vs-calculator/vs-calculator.shared";

type Props = {
  data: VsCalculatorPayload;
  planner: VsCalculatorPlannerPayload;
  onSaved: (payload: VsCalculatorPayload) => void;
};

function defaultHero(index: number): HeroDayCandidate {
  return {
    id: nanoid(8),
    label: `Hero ${index + 1}`,
    tier: "ur",
    heroLevel: 1,
    skillLevels: [1, 1, 1],
    exclusiveWeaponLevel: 0,
    includeWeaponUnlock: true,
  };
}

export function VsCalculatorPlanPanel({ data, planner, onSaved }: Props) {
  const t = useTranslations("vsCalculator.plan");
  const tCommon = useTranslations("common");

  const [spendMode, setSpendMode] = useState<HeroDaySpendMode>(
    planner.pushProfile.plannerSpendMode ?? "free_to_play",
  );
  const [heroes, setHeroes] = useState<HeroDayCandidate[]>(
    planner.pushProfile.heroes.length > 0
      ? planner.pushProfile.heroes
      : [defaultHero(0)],
  );
  const [currentScore, setCurrentScore] = useState(0);
  const [targetScore, setTargetScore] = useState(
    planner.defaultTargetScore ?? 7_200_000,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const gap = Math.max(0, targetScore - currentScore);

  const formatAction = useCallback(
    (action: PlannerAction) => {
      const values = action.labelValues ?? {};
      if (action.kind === "skill_upgrade") {
        return t("actions.skillUpgrade", {
          hero: String(values.hero ?? ""),
          skill: Number(values.skill ?? 0),
          from: Number(values.from ?? 0),
          to: Number(values.to ?? 0),
          medals: Number(values.medals ?? 0),
        });
      }
      if (action.kind === "hero_level_up") {
        return t("actions.heroLevelUp", {
          hero: String(values.hero ?? ""),
          from: Number(values.from ?? 0),
          to: Number(values.to ?? 0),
          exp: Number(values.exp ?? 0),
        });
      }
      if (action.kind === "weapon_upgrade") {
        return t("actions.weaponUpgrade", {
          hero: String(values.hero ?? ""),
          from: Number(values.from ?? 0),
          to: Number(values.to ?? 0),
          shards: Number(values.shards ?? 0),
        });
      }
      if (action.kind === "diamond_pack") {
        return t("actions.diamondPack", {
          count: action.packSize ?? 0,
        });
      }
      if (action.kind === "bag_item" && action.slug === "recruit_ticket") {
        return t("actions.recruitTicket");
      }
      if (action.kind === "hero_shard_burn") {
        return t("actions.heroShardBurn", {
          tier: String(values.tier ?? ""),
          count: Number(values.count ?? 0),
        });
      }
      return action.labelKey;
    },
    [t],
  );

  const plan = useMemo(() => {
    if (gap <= 0 || heroes.length === 0) return null;
    return solveHeroDayPlanner(
      {
        currentScore,
        targetScore,
        candidates: heroes,
        bagQuantities: data.quantities,
        settings: {
          spendMode,
          heroShardBatchSizes: planner.pushProfile.heroShardBatchSizes,
        },
        rates: DEFAULT_HERO_DAY_RATES,
      },
      "exact",
    );
  }, [
    currentScore,
    targetScore,
    heroes,
    data.quantities,
    spendMode,
    planner.pushProfile.heroShardBatchSizes,
    gap,
  ]);

  const saveProfile = useCallback(
    async (nextHeroes: HeroDayCandidate[]) => {
      setBusy(true);
      setError(null);
      const payload: HeroDayPushProfilePayload = {
        heroes: nextHeroes,
        plannerSpendMode: spendMode,
        heroShardBatchSizes: planner.pushProfile.heroShardBatchSizes,
      };
      try {
        const res = await fetch("/api/tools/vs-calculator/push-profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload,
            pinnedDate: data.pinnedDate,
          }),
        });
        const body = (await res.json()) as {
          calculator?: VsCalculatorPayload;
          error?: string;
        };
        if (!res.ok || !body.calculator) {
          throw new Error(body.error ?? t("saveFailed"));
        }
        onSaved(body.calculator);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("saveFailed"));
      } finally {
        setBusy(false);
      }
    },
    [
      data.pinnedDate,
      onSaved,
      planner.pushProfile.heroShardBatchSizes,
      spendMode,
      t,
    ],
  );

  const updateHero = useCallback(
    (id: string, patch: Partial<HeroDayCandidate>) => {
      setHeroes((prev) =>
        prev.map((hero) => (hero.id === id ? { ...hero, ...patch } : hero)),
      );
    },
    [],
  );

  const applyPlanLevels = useCallback(async () => {
    if (!plan) return;
    const next = heroes.map((hero) => {
      let nextHero = { ...hero };
      for (const action of plan.actions) {
        if (action.heroId !== hero.id) continue;
        if (action.kind === "skill_upgrade" && action.skillIndex != null) {
          const skills = [...nextHero.skillLevels] as [number, number, number];
          skills[action.skillIndex] = action.toLevel ?? skills[action.skillIndex];
          nextHero = { ...nextHero, skillLevels: skills };
        }
        if (action.kind === "hero_level_up" && action.toLevel != null) {
          nextHero = { ...nextHero, heroLevel: action.toLevel };
        }
        if (action.kind === "weapon_upgrade" && action.toLevel != null) {
          nextHero = { ...nextHero, exclusiveWeaponLevel: action.toLevel };
        }
      }
      return nextHero;
    });
    setHeroes(next);
    await saveProfile(next);
  }, [heroes, plan, saveProfile]);

  const copyPlan = useCallback(async () => {
    if (!plan) return;
    const lines = plan.actions.map((action) => formatAction(action));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(tCommon("copyFailed"));
    }
  }, [plan, formatAction, tCommon]);

  return (
    <section className="space-y-4" role="tabpanel" data-testid="vs-calculator-plan-panel">
      {planner.tpifMode ? (
        <p className="rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-xs text-hq-fg-muted">
          {t("tpifHint", {
            target: formatVsPoints(planner.defaultTargetScore ?? targetScore),
          })}
        </p>
      ) : null}

      <div className="flex gap-1 rounded-lg border border-hq-border bg-hq-canvas p-1">
        {(["free_to_play", "spending"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={
              spendMode === mode
                ? "flex-1 rounded-md bg-hq-surface-muted px-3 py-2 text-sm font-medium text-hq-fg"
                : "flex-1 rounded-md px-3 py-2 text-sm text-hq-fg-muted hover:text-hq-fg"
            }
            onClick={() => setSpendMode(mode)}
          >
            {t(`spendMode.${mode}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("currentScore")}</span>
          <input
            type="number"
            min={0}
            data-testid="vs-calculator-plan-current-score"
            className="h-10 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 font-mono text-sm text-hq-fg"
            value={currentScore}
            onChange={(e) =>
              setCurrentScore(Math.max(0, Number(e.target.value) || 0))
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-hq-fg-muted">{t("targetScore")}</span>
          <input
            type="number"
            min={0}
            data-testid="vs-calculator-plan-target-score"
            className="h-10 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 font-mono text-sm text-hq-fg"
            value={targetScore}
            onChange={(e) =>
              setTargetScore(Math.max(0, Number(e.target.value) || 0))
            }
          />
        </label>
      </div>

      <p className="text-sm text-hq-fg-muted">
        {t("gapLabel", { gap: formatVsPoints(gap) })}
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-hq-fg">{t("pushSquad")}</h3>
          <button
            type="button"
            disabled={heroes.length >= MAX_HERO_DAY_CANDIDATES || busy}
            className="inline-flex items-center gap-1 rounded-lg border border-hq-border bg-hq-surface-muted px-3 py-2 text-xs text-hq-fg"
            onClick={() => setHeroes((prev) => [...prev, defaultHero(prev.length)])}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t("addHero")}
          </button>
        </div>

        <ul className="space-y-3">
          {heroes.map((hero, index) => (
            <li
              key={hero.id}
              className="rounded-xl border border-hq-border bg-hq-surface p-4"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <input
                  type="text"
                  data-testid={`vs-calculator-plan-hero-label-${index}`}
                  className="min-w-0 flex-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg"
                  value={hero.label}
                  onChange={(e) =>
                    updateHero(hero.id, { label: e.target.value })
                  }
                />
                <button
                  type="button"
                  disabled={heroes.length <= 1 || busy}
                  className="rounded-lg border border-hq-border bg-hq-canvas p-2 text-hq-fg-muted"
                  aria-label={t("removeHero")}
                  onClick={() =>
                    setHeroes((prev) => prev.filter((h) => h.id !== hero.id))
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs">
                  <span className="text-hq-fg-muted">{t("tier")}</span>
                  <select
                    className="h-9 w-full rounded-lg border border-hq-border bg-hq-canvas px-2 text-sm text-hq-fg"
                    value={hero.tier}
                    onChange={(e) =>
                      updateHero(hero.id, {
                        tier: e.target.value as HeroSkillTier,
                      })
                    }
                  >
                    <option value="ur">UR</option>
                    <option value="ssr">SSR</option>
                    <option value="sr">SR</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-hq-fg-muted">{t("heroLevel")}</span>
                  <input
                    type="number"
                    min={1}
                    className="h-9 w-full rounded-lg border border-hq-border bg-hq-canvas px-2 font-mono text-sm text-hq-fg"
                    value={hero.heroLevel}
                    onChange={(e) =>
                      updateHero(hero.id, {
                        heroLevel: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </label>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2">
                {([0, 1, 2] as const).map((skillIndex) => (
                  <label key={skillIndex} className="space-y-1 text-xs">
                    <span className="text-hq-fg-muted">
                      {t("skillLevel", { skill: skillIndex + 1 })}
                    </span>
                    <input
                      type="number"
                      min={1}
                      className="h-9 w-full rounded-lg border border-hq-border bg-hq-canvas px-2 font-mono text-sm text-hq-fg"
                      value={hero.skillLevels[skillIndex]}
                      onChange={(e) => {
                        const next = [...hero.skillLevels] as [
                          number,
                          number,
                          number,
                        ];
                        next[skillIndex] = Math.max(
                          1,
                          Number(e.target.value) || 1,
                        );
                        updateHero(hero.id, { skillLevels: next });
                      }}
                    />
                  </label>
                ))}
              </div>

              {hero.tier === "ur" ? (
                <label className="mt-2 block space-y-1 text-xs">
                  <span className="text-hq-fg-muted">{t("weaponLevel")}</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    className="h-9 w-full rounded-lg border border-hq-border bg-hq-canvas px-2 font-mono text-sm text-hq-fg"
                    value={hero.exclusiveWeaponLevel ?? 0}
                    onChange={(e) =>
                      updateHero(hero.id, {
                        exclusiveWeaponLevel: Math.min(
                          30,
                          Math.max(0, Number(e.target.value) || 0),
                        ),
                      })
                    }
                  />
                </label>
              ) : null}

              <label className="mt-2 flex items-center gap-2 text-xs text-hq-fg-muted">
                <input
                  type="checkbox"
                  checked={hero.allSkillsSameLevel ?? false}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    if (checked) {
                      const level = hero.skillLevels[0];
                      updateHero(hero.id, {
                        allSkillsSameLevel: true,
                        skillLevels: [level, level, level],
                      });
                    } else {
                      updateHero(hero.id, { allSkillsSameLevel: false });
                    }
                  }}
                />
                {t("allSkillsSame")}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          data-testid="vs-calculator-plan-save-profile"
          className="rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm text-hq-fg"
          onClick={() => void saveProfile(heroes)}
        >
          {busy ? t("saving") : t("saveProfile")}
        </button>
      </div>

      <div className="rounded-xl border border-hq-border bg-hq-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-hq-fg">{t("planTitle")}</h3>
          {plan ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-hq-border bg-hq-canvas px-3 py-1.5 text-xs text-hq-fg"
              onClick={() => void copyPlan()}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-hq-green" aria-hidden />
                  {tCommon("copied")}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  {t("copyPlan")}
                </>
              )}
            </button>
          ) : null}
        </div>

        {!plan ? (
          <p className="mt-2 text-sm text-hq-fg-muted">{t("noPlan")}</p>
        ) : (
          <>
            <p className="mt-2 font-mono text-sm tabular-nums text-hq-accent">
              {t("planSummary", {
                points: formatVsPoints(plan.totalPoints),
                projected: formatVsPoints(plan.projectedScore),
              })}
            </p>
            <ul className="mt-3 space-y-2 text-sm text-hq-fg" data-testid="vs-calculator-plan-actions">
              {plan.actions.map((action, index) => (
                <li key={`${action.kind}-${index}`} className="rounded-lg bg-hq-canvas px-3 py-2">
                  {formatAction(action)}{" "}
                  <span className="font-mono text-hq-accent">
                    +{formatVsPoints(action.vsPoints)}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded-lg border border-hq-border bg-hq-surface-muted px-4 py-2 text-sm text-hq-fg"
              onClick={() => void applyPlanLevels()}
            >
              {t("applyLevels")}
            </button>
          </>
        )}
      </div>

      {error ? (
        <p className="text-sm text-hq-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
