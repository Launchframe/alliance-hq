"use client";

import { useLocale, useTranslations } from "next-intl";
import { NoteMarkdown } from "./NoteMarkdown";

type Sections = { keyDecisions?: string[]; openQuestions?: string[] };
export function NoteSections({ value, onChange, disabled = false }: { value: Sections; onChange?: (patch: Sections) => void; disabled?: boolean }) {
  const t = useTranslations("notes.documents");
  const locale = useLocale();
  return <>{(["keyDecisions", "openQuestions"] as const).map((field) => {
    const items = value[field] ?? [];
    if (!onChange && !items.length) return null;
    return <section key={field} className="my-4 space-y-3">
      <h3 className="text-sm font-semibold">{t(field)}</h3>
      {items.map((item, index) => <div key={index} className="space-y-2">
        {onChange ? <><textarea aria-label={`${t(field)} ${(index + 1).toLocaleString(locale)}`} disabled={disabled} rows={2} maxLength={10_000} value={item} onChange={(event) => onChange({ [field]: items.map((text, at) => at === index ? event.target.value : text) })} className="w-full rounded-lg border border-hq-border bg-hq-canvas px-3 py-2 text-sm" /><button type="button" disabled={disabled} onClick={() => onChange({ [field]: items.filter((_, at) => at !== index) })} className="text-xs text-hq-fg-muted">{t("removeItem")}</button></> : <NoteMarkdown body={item} />}
      </div>)}
      {onChange && <button type="button" disabled={disabled || items.length >= 100} onClick={() => onChange({ [field]: [...items, ""] })} className="rounded-lg border border-hq-border px-3 py-2 text-xs">{t(field === "keyDecisions" ? "addDecision" : "addQuestion")}</button>}
    </section>;
  })}</>;
}
