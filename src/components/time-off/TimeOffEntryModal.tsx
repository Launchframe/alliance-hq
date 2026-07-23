"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";

type MemberOption = { id: string; current_name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export function TimeOffEntryModal({ open, onClose, onSaved }: Props) {
  const t = useTranslations("timeOff");
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [ashedMemberId, setAshedMemberId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [entryKind, setEntryKind] = useState<"officer_marked" | "unexpected">(
    "officer_marked",
  );
  const [availability, setAvailability] = useState("full_away");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/members")
      .then((res) => res.json())
      .then((data: { members?: MemberOption[] }) => {
        setMembers(
          (data.members ?? [])
            .filter((member) => member.current_name)
            .sort((a, b) => a.current_name.localeCompare(b.current_name)),
        );
      })
      .catch(() => setMembers([]));
  }, [open]);

  if (!open) return null;

  const selectedMember = members.find((member) => member.id === ashedMemberId);

  const save = async () => {
    if (!selectedMember || !startDate || !endDate) {
      setError(t("errors.fieldsRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/time-off/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ashedMemberId: selectedMember.id,
          memberName: selectedMember.current_name,
          startDate,
          endDate,
          notes: notes.trim() || null,
          availability,
          entryKind,
          source: "officer",
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? t("errors.saveFailed"));
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg border border-hq-border bg-hq-bg p-4 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-hq-fg">{t("officerModal.title")}</h2>
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            preventDefaultFormSubmit(event);
            void save();
          }}
        >
          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("officerModal.member")}</span>
            <select
              value={ashedMemberId}
              onChange={(event) => setAshedMemberId(event.target.value)}
              className="mt-1 w-full rounded border border-hq-border bg-hq-bg px-2 py-2 text-sm"
              required
            >
              <option value="">{t("officerModal.memberPlaceholder")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.current_name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("officerModal.kind")}</span>
            <select
              value={entryKind}
              onChange={(event) =>
                setEntryKind(event.target.value as "officer_marked" | "unexpected")
              }
              className="mt-1 w-full rounded border border-hq-border bg-hq-bg px-2 py-2 text-sm"
            >
              <option value="officer_marked">{t("officerModal.kindPlanned")}</option>
              <option value="unexpected">{t("officerModal.kindUnexpected")}</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-hq-fg-muted">{t("officerModal.start")}</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="mt-1 w-full rounded border border-hq-border bg-hq-bg px-2 py-2 text-sm"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-hq-fg-muted">{t("officerModal.end")}</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
                className="mt-1 w-full rounded border border-hq-border bg-hq-bg px-2 py-2 text-sm"
                required
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("officerModal.availability")}</span>
            <select
              value={availability}
              onChange={(event) => setAvailability(event.target.value)}
              className="mt-1 w-full rounded border border-hq-border bg-hq-bg px-2 py-2 text-sm"
            >
              <option value="full_away">{t("availability.full_away")}</option>
              <option value="limited">{t("availability.limited")}</option>
              <option value="minimums">{t("availability.minimums")}</option>
              <option value="hit_and_miss">{t("availability.hit_and_miss")}</option>
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-hq-fg-muted">{t("officerModal.notes")}</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-hq-border bg-hq-bg px-2 py-2 text-sm"
            />
          </label>

          {error ? (
            <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-hq-border px-3 py-2 text-sm"
            >
              {t("officerModal.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-hq-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {t("officerModal.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
