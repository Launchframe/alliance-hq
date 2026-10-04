"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import type { SupportDisplayPreferences, UnsortedFilters } from "@/lib/support-teams/display-preferences.shared";
import { chipMetrics, countryPresentation, metricLabels, supportErrorKey } from "@/lib/support-teams/board-client.shared";
import type { SupportRosterMember } from "@/lib/support-teams/types.shared";

export const supportButton = "rounded-lg border border-hq-border px-3 py-2 text-sm hover:bg-hq-surface-muted disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-hq-accent";
export const supportInput = "w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm";
export function SupportErrorMessage({ code, history = false, reveal = true }: { code?: string; history?: boolean; reveal?: boolean }) {
  const t = useTranslations("supportTeams");
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (code && reveal) ref.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [code, reveal]);
  return code ? <p ref={ref} role="alert" className="my-2 text-sm text-hq-danger">{t(supportErrorKey(code, history), { max: 60 })}</p> : null;
}
export function SupportDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-label={title} className="fixed inset-0 m-auto max-h-[90dvh] w-[min(96vw,56rem)] overflow-y-auto rounded-xl border border-hq-border bg-hq-surface p-4 text-hq-fg backdrop:bg-black/70">
    <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{title}</h2><button type="button" className={supportButton} onClick={onClose}>{t("battlePlan.actions.close")}</button></div>{children}
  </dialog>;
}
export function SupportTeamDisplaySettings({ display, disabled, saving, onChange, error }: { display: SupportDisplayPreferences; disabled: boolean; saving: boolean; onChange: (next: SupportDisplayPreferences) => void; error?: string }) {
  const t = useTranslations("supportTeams");
  const tc = useTranslations("common");
  const [staged, setStaged] = useState<SupportDisplayPreferences | null>(null);
  return <details className="rounded-lg border border-hq-border p-3"><summary className="cursor-pointer">{t("displaySettings")}</summary><fieldset disabled={disabled} aria-busy={disabled} className="mt-3 flex flex-wrap gap-4">{chipMetrics.map((key) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(saving && staged ? staged : display)[key]} onChange={(event) => { const next = { ...display, [key]: event.target.checked }; setStaged(next); onChange(next); }} />{t(metricLabels[key])}</label>)}</fieldset>{saving && staged && <p role="status" className="mt-2 text-sm">{tc("loading")}</p>}<SupportErrorMessage code={error} /></details>;
}
export function UnsortedFiltersControl({ filters, setFilters, roster }: { filters: UnsortedFilters; setFilters: (value: UnsortedFilters) => void; roster: SupportRosterMember[] }) {
  const t = useTranslations("supportTeams");
  const locale = useLocale();
  return <details className="my-3"><summary className="cursor-pointer text-sm">{t("filters")}</summary>
    <div className="space-y-3 py-3"><AppSelect value={filters.countries?.[0] ?? ""} onChange={(value) => setFilters({ ...filters, countries: value ? [value] : [] })} aria-label={t("country")} placeholder={t("country")} options={[{ value: "", label: t("resetFilters") }, ...[...new Set(roster.map((member) => member.country ?? "unknown"))].sort().map((country) => ({ value: country, label: countryPresentation(country, locale, t("unknown")).label }))]} />
    {chipMetrics.map((key) => <fieldset key={key} className="grid grid-cols-2 gap-2"><legend className="text-xs">{t(metricLabels[key])}</legend>
      {(["min", "max"] as const).map((bound) => <label key={bound} className="text-xs">{bound === "min" ? "≥" : "≤"}<input className={supportInput} type="number" min={0} aria-label={`${t(metricLabels[key])} ${bound === "min" ? "≥" : "≤"}`} value={filters[key]?.[bound] ?? ""} onChange={(event) => setFilters({ ...filters, [key]: { ...filters[key], [bound]: event.target.value === "" ? undefined : Number(event.target.value) } })} /></label>)}
      <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={filters[key]?.unknown !== "exclude"} onChange={(event) => setFilters({ ...filters, [key]: { ...filters[key], unknown: event.target.checked ? "include" : "exclude" } })} />{t("unknown")}</label>
    </fieldset>)}<button type="button" className={supportButton} onClick={() => setFilters({})}>{t("resetFilters")}</button><p className="text-xs text-hq-fg-muted">{t("countryHint")}</p></div>
  </details>;
}
