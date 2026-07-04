"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { AppSelect } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import {
  FORM_SUBMIT_ENTER_KEY_HINT,
  preventDefaultFormSubmit,
} from "@/lib/client/form-enter-submit.shared";
import { resolvePromptTemplateBodyWithLegacy } from "@/lib/trains/prompt-resolution.shared";
import {
  createPromptTemplate,
  updatePromptTemplate,
} from "@/lib/trains/prompt-templates-client";
import type {
  PromptTemplateDetail,
  PromptVisibility,
} from "@/lib/trains/prompt-templates.shared";
import { CONDUCTOR_MECHANISMS } from "@/lib/trains/types";

type RosterMember = {
  memberId: string;
  memberName: string;
};

type Props = {
  allianceName: string;
  allianceTag: string;
  seasonKey: string | null;
  roster: RosterMember[];
  initialTemplate?: PromptTemplateDetail | null;
};

export function PromptStudioForm({
  allianceName,
  allianceTag,
  seasonKey,
  roster,
  initialTemplate = null,
}: Props) {
  const t = useTranslations("trains.promptStudio");
  const isEdit = Boolean(initialTemplate);
  const [title, setTitle] = useState(initialTemplate?.title ?? "");
  const [body, setBody] = useState(
    initialTemplate?.currentRevision.body ?? "",
  );
  const [visibility, setVisibility] = useState<PromptVisibility>(
    initialTemplate?.visibility ?? "internal",
  );
  const [selectedSeasonKey, setSelectedSeasonKey] = useState<string>(
    initialTemplate?.seasonKey ?? seasonKey ?? "",
  );
  const [conductorMechanism, setConductorMechanism] = useState<string>(
    initialTemplate?.conductorMechanism ?? "",
  );
  const [targetMemberId, setTargetMemberId] = useState<string>(
    initialTemplate?.targetConductorAshedMemberId ?? "",
  );
  const [memberQuery, setMemberQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(
    initialTemplate?.id ?? null,
  );

  const visibilityOptions = useMemo(
    (): Array<{ value: PromptVisibility; label: string }> => [
      { value: "private", label: t("visibilityPrivate") },
      { value: "internal", label: t("visibilityInternal") },
      { value: "public", label: t("visibilityPublic") },
    ],
    [t],
  );

  const filteredRoster = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((member) =>
      member.memberName.toLowerCase().includes(q),
    );
  }, [memberQuery, roster]);

  const preview = useMemo(() => {
    const sampleCommander =
      roster.find((member) => member.memberId === targetMemberId)?.memberName ??
      roster[0]?.memberName ??
      "Commander Name";
    return resolvePromptTemplateBodyWithLegacy(body, {
      commander: { name: sampleCommander, bio: null },
      alliance: { name: allianceName, tag: allianceTag },
      seasonKey: selectedSeasonKey || seasonKey,
      conductorMechanism: conductorMechanism || null,
    });
  }, [
    allianceName,
    allianceTag,
    body,
    conductorMechanism,
    roster,
    seasonKey,
    selectedSeasonKey,
    targetMemberId,
  ]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        templateType: "image" as const,
        title: title.trim(),
        body: body.trim(),
        visibility,
        seasonKey: selectedSeasonKey.trim() || null,
        conductorMechanism:
          (conductorMechanism as (typeof CONDUCTOR_MECHANISMS)[number]) || null,
        targetConductorAshedMemberId: targetMemberId.trim() || null,
      };
      if (!payload.title || !payload.body) {
        throw new Error(t("requiredFields"));
      }
      const template = isEdit && initialTemplate
        ? await updatePromptTemplate(initialTemplate.id, payload)
        : await createPromptTemplate(payload);
      setSavedId(template.id);
    } catch (e) {
      setError(
        e instanceof Error && e.message === t("requiredFields")
          ? e.message
          : e instanceof Error
            ? e.message
            : t("saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#e6edf3]">
          {isEdit ? t("editTitle") : t("title")}
        </h1>
        <p className="mt-1 text-sm text-[#8b949e]">{t("subtitle")}</p>
      </div>

      <form
        className="flex flex-col gap-5 rounded-2xl border border-[#30363d] bg-[#161b22] p-5"
        onSubmit={(event) => {
          preventDefaultFormSubmit(event);
          void handleSave();
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[#8b949e]">{t("templateTitle")}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[#e6edf3]"
            enterKeyHint={FORM_SUBMIT_ENTER_KEY_HINT}
            required
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-[#8b949e]">{t("templateBody")}</span>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="min-h-[180px] font-mono text-sm"
            required
          />
          <span className="text-xs text-[#6e7681]">{t("templateBodyHint")}</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[#8b949e]">{t("visibility")}</span>
            <AppSelect
              value={visibility}
              onChange={(value) => setVisibility(value as PromptVisibility)}
              options={visibilityOptions.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-[#8b949e]">{t("season")}</span>
            <input
              value={selectedSeasonKey}
              onChange={(e) => setSelectedSeasonKey(e.target.value)}
              placeholder={t("seasonAny")}
              className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[#e6edf3]"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            <span className="text-[#8b949e]">{t("mechanism")}</span>
            <AppSelect
              value={conductorMechanism}
              onChange={setConductorMechanism}
              options={[
                { value: "", label: t("mechanismAny") },
                ...CONDUCTOR_MECHANISMS.map((mechanism) => ({
                  value: mechanism,
                  label: mechanism,
                })),
              ]}
            />
          </label>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm text-[#8b949e]">{t("member")}</span>
            <input
              type="search"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder={t("memberAny")}
              className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3]"
            />
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[#30363d] bg-[#0d1117]">
              <button
                type="button"
                onClick={() => setTargetMemberId("")}
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-[#161b22] ${
                  !targetMemberId ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e]"
                }`}
              >
                {t("memberAny")}
              </button>
              {filteredRoster.map((member) => (
                <button
                  key={member.memberId}
                  type="button"
                  onClick={() => setTargetMemberId(member.memberId)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-[#161b22] ${
                    targetMemberId === member.memberId
                      ? "bg-[#21262d] text-[#e6edf3]"
                      : "text-[#8b949e]"
                  }`}
                >
                  {member.memberName}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
          <div className="text-xs uppercase tracking-wide text-[#8b949e]">
            {t("preview")}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[#e6edf3]">
            {preview || t("previewEmpty")}
          </p>
        </div>

        {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
        {savedId && !error ? (
          <p className="text-sm text-[#3fb950]">{t("saved")}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? t("saving") : t("save")}
          </Button>
          <Link
            href="/trains"
            className="inline-flex h-10 items-center rounded-lg border border-[#30363d] px-4 text-sm text-[#e6edf3] hover:bg-[#21262d]"
          >
            {t("cancel")}
          </Link>
        </div>
      </form>
    </div>
  );
}
