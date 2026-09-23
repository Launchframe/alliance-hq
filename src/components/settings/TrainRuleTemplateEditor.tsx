"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Dialog } from "@/components/ui/dialog";
import {
  conductorRuleLabelKey,
  vipRuleLabelKey,
  type ConductorRule,
  type VipRule,
} from "@/lib/trains/rules/catalog.shared";
import {
  DAY_RULE_PALETTE,
  RULE_PALETTE_SWATCHES,
  defaultScopeForPaletteId,
  paletteEntry,
  paletteIdForRule,
  ruleForPaletteSelection,
  scopeForRule,
} from "@/lib/trains/rules/palette.shared";
import { WEEKDAY_KEYS } from "@/lib/trains/rules/presets.shared";
import {
  validateTemplateWeekRules,
  type TemplateWeekRules,
  type WeekdayKey,
} from "@/lib/trains/rules/template-days.shared";

/** VIP options an officer can set per slot. `null` is the conductor's pick. */
const VIP_OPTIONS: Array<{ id: string; rule: VipRule | null }> = [
  { id: "conductor_pick", rule: null },
  { id: "none", rule: { kind: "none" } },
  { id: "donations_second", rule: { kind: "donations_second" } },
  {
    id: "event_top_x",
    rule: { kind: "event_top_x", eventKey: "capitol_war", topN: 10 },
  },
];

// Mon-first for display; WEEKDAY_KEYS is indexed by day-of-week (Sun = 0).
const DISPLAY_WEEKDAYS: WeekdayKey[] = [
  ...WEEKDAY_KEYS.slice(1),
  WEEKDAY_KEYS[0],
];

type Props = {
  open: boolean;
  /** Null when creating. */
  initialName: string;
  initialDescription: string;
  initialDays: TemplateWeekRules;
  /** Alliance conductor lead time, for source-day warnings. */
  leadDays: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (input: {
    name: string;
    description: string;
    days: TemplateWeekRules;
  }) => void;
};

export function TrainRuleTemplateEditor({
  open,
  initialName,
  initialDescription,
  initialDays,
  leadDays,
  busy = false,
  error = null,
  onClose,
  onSave,
}: Props) {
  const t = useTranslations("settings.trainTemplates");
  const tRules = useTranslations("trains.rules");
  const tWeekdays = useTranslations("trains.weekdays");

  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [days, setDays] = useState<TemplateWeekRules>(initialDays);
  const [openSlot, setOpenSlot] = useState<WeekdayKey | null>(null);

  const warnings = useMemo(
    () => validateTemplateWeekRules(days, leadDays),
    [days, leadDays],
  );
  const warningByDay = useMemo(
    () => new Map(warnings.map((warning) => [warning.weekday, warning])),
    [warnings],
  );

  function setSlot(weekday: WeekdayKey, next: Partial<(typeof days)[WeekdayKey]>) {
    setDays((current) => ({
      ...current,
      [weekday]: { ...current[weekday], ...next },
    }));
  }

  function conductorLabel(rule: ConductorRule | null): string {
    const scope = scopeForRule(rule);
    const label = tRules(conductorRuleLabelKey(rule));
    return scope != null ? `${label} ${scope}` : label;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
      title={t("editorTitle")}
      className="max-w-2xl p-0"
    >
      <div className="flex flex-col">
        <div className="border-b border-hq-border px-5 py-4">
          <h2 className="text-lg font-semibold text-hq-fg">
            {t("editorTitle")}
          </h2>
          <p className="mt-1 text-sm text-hq-fg-muted">{t("editorBody")}</p>
        </div>

        <div className="max-h-[min(60vh,560px)] space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-sm font-medium text-hq-fg">
              {t("nameLabel")}
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              disabled={busy}
              data-testid="trains-template-editor-name"
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-hq-fg">
              {t("descriptionLabel")}
            </span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={280}
              disabled={busy}
              className="mt-1 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm text-hq-fg disabled:opacity-50"
            />
          </label>

          <div className="space-y-2">
            <p className="text-sm font-medium text-hq-fg">{t("daysLabel")}</p>
            <p className="text-xs text-hq-fg-muted">{t("daysHint")}</p>

            {DISPLAY_WEEKDAYS.map((weekday) => {
              const slot = days[weekday];
              const paletteId = paletteIdForRule(slot.conductorRule);
              const swatch = RULE_PALETTE_SWATCHES[paletteId]?.swatch;
              const warning = warningByDay.get(weekday);
              const expanded = openSlot === weekday;

              return (
                <div
                  key={weekday}
                  className="rounded-lg border border-hq-border bg-hq-canvas"
                  data-testid={`trains-template-editor-slot-${weekday}`}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOpenSlot(expanded ? null : weekday)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left disabled:opacity-50"
                  >
                    <span className="w-10 shrink-0 text-xs font-medium uppercase tracking-wide text-hq-fg-muted">
                      {tWeekdays(weekday)}
                    </span>
                    <span
                      className={`h-3 w-3 shrink-0 rounded-sm ${swatch}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-hq-fg">
                      {conductorLabel(slot.conductorRule)}
                      <span className="text-hq-fg-muted">
                        {" · "}
                        {tRules(vipRuleLabelKey(slot.vipRule))}
                      </span>
                    </span>
                    {warning ? (
                      <span
                        className="shrink-0 rounded border border-[#d29922]/60 px-1.5 py-0.5 text-[10px] font-medium text-[#d29922]"
                        title={t("sourceDayWarning")}
                        data-testid={`trains-template-editor-warning-${weekday}`}
                      >
                        {t("warningBadge")}
                      </span>
                    ) : null}
                  </button>

                  {expanded ? (
                    <div className="space-y-3 border-t border-hq-border px-3 py-3">
                      {warning ? (
                        <p className="rounded-md border border-[#d29922]/40 bg-[#d29922]/10 px-2 py-1.5 text-xs leading-relaxed text-[#d29922]">
                          {t("sourceDayWarning")}
                        </p>
                      ) : null}

                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                          {t("conductorLabel")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {DAY_RULE_PALETTE.map((entry) => {
                            const selected = paletteId === entry.id;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                disabled={busy}
                                data-testid={`trains-template-editor-rule-${entry.id}`}
                                onClick={() =>
                                  setSlot(weekday, {
                                    conductorRule: ruleForPaletteSelection(
                                      entry.id,
                                      scopeForRule(slot.conductorRule) ??
                                        defaultScopeForPaletteId(entry.id),
                                    ),
                                  })
                                }
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                  selected
                                    ? "border-hq-accent bg-hq-accent/15 text-hq-fg"
                                    : "border-hq-border text-hq-fg-muted hover:bg-hq-surface"
                                }`}
                              >
                                <span
                                  className={`h-2.5 w-2.5 rounded-sm ${RULE_PALETTE_SWATCHES[entry.id]?.swatch}`}
                                  aria-hidden
                                />
                                {tRules(
                                  conductorRuleLabelKey(
                                    ruleForPaletteSelection(
                                      entry.id,
                                      defaultScopeForPaletteId(entry.id),
                                    ),
                                  ),
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {paletteEntry(paletteId)?.scopes?.length ? (
                        <div>
                          <p className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                            {t("scopeLabel")}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {paletteEntry(paletteId)?.scopes?.map((scope) => (
                              <button
                                key={scope}
                                type="button"
                                disabled={busy}
                                data-testid={`trains-template-editor-scope-${scope}`}
                                onClick={() =>
                                  setSlot(weekday, {
                                    conductorRule: ruleForPaletteSelection(
                                      paletteId,
                                      scope,
                                    ),
                                  })
                                }
                                className={`rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                  scopeForRule(slot.conductorRule) === scope
                                    ? "border-hq-accent bg-hq-accent/15 text-hq-fg"
                                    : "border-hq-border text-hq-fg-muted hover:bg-hq-surface"
                                }`}
                              >
                                {t("scopeOption", { count: scope })}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div>
                        <p className="text-[10px] font-medium uppercase tracking-wide text-hq-fg-muted">
                          {t("vipLabel")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {VIP_OPTIONS.map((option) => {
                            const selected =
                              vipRuleLabelKey(slot.vipRule) ===
                              vipRuleLabelKey(option.rule);
                            return (
                              <button
                                key={option.id}
                                type="button"
                                disabled={busy}
                                data-testid={`trains-template-editor-vip-${option.id}`}
                                onClick={() =>
                                  setSlot(weekday, { vipRule: option.rule })
                                }
                                className={`rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                                  selected
                                    ? "border-hq-accent bg-hq-accent/15 text-hq-fg"
                                    : "border-hq-border text-hq-fg-muted hover:bg-hq-surface"
                                }`}
                              >
                                {tRules(vipRuleLabelKey(option.rule))}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {error ? (
            <p
              className="text-sm text-hq-danger"
              data-testid="trains-template-editor-error"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-hq-border px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-hq-border px-4 py-2 text-sm font-medium text-hq-fg hover:bg-hq-canvas disabled:opacity-50"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy || name.trim().length === 0}
            data-testid="trains-template-editor-save"
            onClick={() =>
              onSave({ name: name.trim(), description: description.trim(), days })
            }
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-400 disabled:opacity-50"
          >
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
