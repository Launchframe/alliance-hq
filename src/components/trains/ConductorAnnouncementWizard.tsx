"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { MemberPortrait } from "@/components/members/MemberPortrait";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/AppSelect";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@/i18n/navigation";
import {
  createPromptTemplate,
  fetchConductorPortrait,
  fetchPromptTemplates,
  finalizeConductorImage,
  generateConductorImages,
  sortPromptTemplatesForConductor,
} from "@/lib/trains/prompt-templates-client";
import { resolvePromptTemplateBodyWithLegacy } from "@/lib/trains/prompt-resolution.shared";
import type {
  ConductorGeneratedImage,
  ConductorPortraitPayload,
  ImageModelProvider,
  PromptTemplateSummary,
} from "@/lib/trains/prompt-templates.shared";

type ConductorRecordContext = {
  id: string;
  conductorMemberId: string | null;
  conductorMemberName: string | null;
  conductorMechanism: string | null;
  vipMemberName: string | null;
  date: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: ConductorRecordContext;
  allianceTag: string;
  allianceName: string;
  seasonKey: string | null;
  canManageTrains: boolean;
};

type WizardStep = "prompt" | "gallery" | "finalize";

export function ConductorAnnouncementWizard({
  open,
  onOpenChange,
  record,
  allianceTag,
  allianceName,
  seasonKey,
  canManageTrains,
}: Props) {
  const t = useTranslations("trains.announcementWizard");
  const tPromptStudio = useTranslations("trains.promptStudio");

  const providerOptions = useMemo(
    (): Array<{ value: ImageModelProvider; label: string }> => [
      { value: "craiyon", label: t("providerCraiyon") },
      { value: "fal", label: t("providerFal") },
    ],
    [t],
  );

  const [step, setStep] = useState<WizardStep>("prompt");
  const [templates, setTemplates] = useState<PromptTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [promptBody, setPromptBody] = useState("");
  const [promptEdited, setPromptEdited] = useState(false);
  const [modelProvider, setModelProvider] =
    useState<ImageModelProvider>("craiyon");
  const [portrait, setPortrait] = useState<ConductorPortraitPayload | null>(
    null,
  );
  const [portraitLoading, setPortraitLoading] = useState(false);
  const [draftImage, setDraftImage] = useState<ConductorGeneratedImage | null>(
    null,
  );
  const [finalImage, setFinalImage] = useState<ConductorGeneratedImage | null>(
    null,
  );
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savePromptOpen, setSavePromptOpen] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep("prompt");
      setSelectedTemplateId("");
      setPromptBody("");
      setPromptEdited(false);
      setModelProvider("craiyon");
      setDraftImage(null);
      setFinalImage(null);
      setSelectedUrl(null);
      setBusy(false);
      setError(null);
      setSavePromptOpen(false);
      setTemplates([]);
      setPortrait(null);
    }
    onOpenChange(nextOpen);
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setTemplatesLoading(true);
      setPortraitLoading(true);
      void Promise.all([
        fetchPromptTemplates({ type: "image" }),
        fetchConductorPortrait(record.id),
      ])
        .then(([loadedTemplates, loadedPortrait]) => {
          if (cancelled) return;
          const sorted = sortPromptTemplatesForConductor({
            templates: loadedTemplates,
            conductorMemberId: record.conductorMemberId,
            seasonKey,
            conductorMechanism: record.conductorMechanism,
            previouslyUsedTemplateIds: [],
          });
          setTemplates(sorted);
          setPortrait(loadedPortrait);
          const first = sorted[0];
          if (first) {
            setSelectedTemplateId(first.id);
            setPromptBody(first.currentRevision.body);
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError(
              e instanceof Error ? e.message : t("loadFailed"),
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setTemplatesLoading(false);
            setPortraitLoading(false);
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    open,
    record.conductorMechanism,
    record.conductorMemberId,
    record.id,
    seasonKey,
    t,
  ]);

  const resolvedPrompt = useMemo(() => {
    return resolvePromptTemplateBodyWithLegacy(promptBody, {
      commander: {
        name: record.conductorMemberName ?? t("commanderFallback"),
        bio: null,
      },
      alliance: { name: allianceName, tag: allianceTag },
      seasonKey,
      conductorMechanism: record.conductorMechanism,
      date: record.date,
      vip: { name: record.vipMemberName },
    });
  }, [
    allianceName,
    allianceTag,
    promptBody,
    record.conductorMechanism,
    record.conductorMemberName,
    record.date,
    record.vipMemberName,
    seasonKey,
    t,
  ]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (template) {
      setPromptBody(template.currentRevision.body);
      setPromptEdited(false);
    }
  };

  const handlePromptBodyChange = (value: string) => {
    setPromptBody(value);
    setPromptEdited(true);
  };

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const image = await generateConductorImages({
        conductorRecordId: record.id,
        promptBody: resolvedPrompt,
        promptTemplateId: selectedTemplateId || null,
        modelProvider,
        modelType: "art",
        portraitUrl: portrait?.url ?? null,
      });
      setDraftImage(image);
      setSelectedUrl(image.externalImageUrls[0] ?? null);
      setStep("gallery");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGenerate"));
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    if (!draftImage || !selectedUrl) return;
    setBusy(true);
    setError(null);
    try {
      const image = await finalizeConductorImage({
        conductorRecordId: record.id,
        imageId: draftImage.id,
        selectedExternalUrl: selectedUrl,
      });
      setFinalImage(image);
      setStep("finalize");
      if (promptEdited) {
        setSavePromptOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("finalizeFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEditedPrompt = async () => {
    if (!promptBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createPromptTemplate({
        templateType: "image",
        title: tPromptStudio("saveTitleDefault", {
          name: record.conductorMemberName ?? t("commanderFallback"),
          date: record.date,
        }),
        body: promptBody.trim(),
        visibility: "internal",
        seasonKey,
        conductorMechanism:
          (record.conductorMechanism as PromptTemplateSummary["conductorMechanism"]) ??
          null,
        targetConductorAshedMemberId: record.conductorMemberId,
      });
      setSavePromptOpen(false);
      setPromptEdited(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("savePromptFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadUrl = finalImage?.downloadUrl ?? null;

  if (!canManageTrains) return null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        title={t("title")}
        className="max-w-4xl"
        ignoreOutsideDismiss={busy}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#8b949e]">
            <StepBadge active={step === "prompt"} label={t("stepPrompt")} />
            <span aria-hidden>→</span>
            <StepBadge active={step === "gallery"} label={t("stepGallery")} />
            <span aria-hidden>→</span>
            <StepBadge
              active={step === "finalize"}
              label={t("stepFinalize")}
            />
          </div>

          {step === "prompt" ? (
            <div className="grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)]">
              <div className="flex flex-col items-center gap-2 rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
                <div className="text-xs uppercase tracking-wide text-[#8b949e]">
                  {t("portraitReference")}
                </div>
                {record.conductorMemberId ? (
                  <MemberPortrait
                    allianceTag={allianceTag}
                    memberId={record.conductorMemberId}
                    memberName={record.conductorMemberName ?? t("commanderFallback")}
                    size="lg"
                    eager
                  />
                ) : null}
                <p className="text-center text-sm font-medium text-[#e6edf3]">
                  {record.conductorMemberName}
                </p>
                {portraitLoading ? (
                  <p className="text-xs text-[#8b949e]">{t("loadingPortrait")}</p>
                ) : null}
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[#8b949e]">{t("selectPrompt")}</span>
                  <AppSelect
                    value={selectedTemplateId}
                    onChange={handleTemplateChange}
                    disabled={templatesLoading || templates.length === 0}
                    placeholder={t("noTemplates")}
                    options={templates.map((template) => ({
                      value: template.id,
                      label: template.title,
                    }))}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[#8b949e]">{t("customPrompt")}</span>
                  <Textarea
                    value={promptBody}
                    onChange={(e) => handlePromptBodyChange(e.target.value)}
                    rows={6}
                  />
                </label>

                <div className="rounded-xl border border-[#30363d] bg-[#0d1117] p-3 text-sm text-[#e6edf3]">
                  {resolvedPrompt || t("previewEmpty")}
                </div>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[#8b949e]">{t("provider")}</span>
                  <AppSelect
                    value={modelProvider}
                    onChange={(value) =>
                      setModelProvider(value as ImageModelProvider)
                    }
                    options={providerOptions}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy || !resolvedPrompt.trim()}
                    onClick={() => void handleGenerate()}
                  >
                    {busy ? t("generating") : t("generate")}
                  </Button>
                  <Link
                    href="/trains/prompts/new"
                    className="inline-flex h-10 items-center rounded-lg border border-[#30363d] px-4 text-sm text-[#e6edf3] hover:bg-[#21262d]"
                  >
                    {t("createTemplateLink")}
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          {step === "gallery" ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[#8b949e]">{t("selectImage")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(draftImage?.externalImageUrls ?? []).map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setSelectedUrl(url)}
                    className={`overflow-hidden rounded-lg border ${
                      selectedUrl === url
                        ? "border-[#58a6ff] ring-2 ring-[#58a6ff]/40"
                        : "border-[#30363d]"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      className="aspect-square w-full object-cover"
                    />
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setStep("prompt");
                    void handleGenerate();
                  }}
                >
                  {busy ? t("generating") : t("regenerate")}
                </Button>
                <Button
                  type="button"
                  disabled={busy || !selectedUrl}
                  onClick={() => void handleFinalize()}
                >
                  {busy ? t("finalizing") : t("finalize")}
                </Button>
              </div>
            </div>
          ) : null}

          {step === "finalize" ? (
            <div className="flex flex-col items-center gap-4">
              {downloadUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={downloadUrl}
                    alt=""
                    className="max-h-[420px] w-full max-w-md rounded-xl border border-[#30363d] object-contain"
                  />
                  <a
                    href={downloadUrl}
                    download
                    className="inline-flex h-10 items-center rounded-lg bg-[#238636] px-4 text-sm font-medium text-white hover:bg-[#2ea043]"
                  >
                    {t("download")}
                  </a>
                </>
              ) : null}
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                {t("done")}
              </Button>
            </div>
          ) : null}

          {error ? <p className="text-sm text-[#f85149]">{error}</p> : null}
        </div>
      </Dialog>

      <Dialog
        open={savePromptOpen}
        onOpenChange={setSavePromptOpen}
        title={t("savePromptTitle")}
        className="max-w-md"
      >
        <p className="text-sm text-[#8b949e]">{t("savePromptBody")}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy}
            onClick={() => void handleSaveEditedPrompt()}
          >
            {t("savePromptConfirm")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSavePromptOpen(false)}
          >
            {t("savePromptSkip")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function StepBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 ${
        active
          ? "bg-[#388bfd]/20 text-[#58a6ff]"
          : "bg-[#21262d] text-[#8b949e]"
      }`}
    >
      {label}
    </span>
  );
}
