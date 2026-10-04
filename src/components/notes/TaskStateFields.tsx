"use client";

import { useTranslations } from "next-intl";
import { AppSelect } from "@/components/ui/AppSelect";
import { TASK_STATUSES, type TaskStatus } from "@/lib/notes/tasks.shared";
import { NOTE_PRIORITIES, type NotePriority } from "@/lib/notes/workspace.shared";

export function TaskStateFields({ status, priority, disabled, onStatus, onPriority }: {
  status: TaskStatus; priority: NotePriority; disabled?: boolean;
  onStatus: (value: TaskStatus) => void; onPriority: (value: NotePriority) => void;
}) {
  const t = useTranslations("notes");
  return <div className="grid grid-cols-2 gap-2">
    <AppSelect aria-label={t("tasks.statusLabel")} value={status} disabled={disabled} onChange={(value) => onStatus(value as TaskStatus)} options={TASK_STATUSES.map((value) => ({ value, label: t(`tasks.status.${value}`) }))} />
    <AppSelect aria-label={t("fields.priority")} value={priority ?? "none"} disabled={disabled} onChange={(value) => onPriority(value === "none" ? null : value as NotePriority)} options={["none", ...NOTE_PRIORITIES].map((value) => ({ value, label: t(`priority.${value}`) }))} />
  </div>;
}
