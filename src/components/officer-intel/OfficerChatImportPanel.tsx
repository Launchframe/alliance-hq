"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Upload, X } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { preventDefaultFormSubmit } from "@/lib/client/form-enter-submit.shared";
import type {
  OfficerChatImportMessageInput,
  ParsedOfficerChatMessage,
} from "@/lib/officer-intel/types.shared";

type SelectedScreenshot = {
  id: string;
  file: File;
  previewUrl: string;
};

type ParseResponse = {
  messages?: ParsedOfficerChatMessage[];
  error?: string;
};

type Props = {
  onClose: () => void;
  onImported: (sessionId: string) => void | Promise<void>;
};

function newScreenshotId(): string {
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function OfficerChatImportPanel({ onClose, onImported }: Props) {
  const t = useTranslations("officerIntel");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [channelLabel, setChannelLabel] = useState("R4 & R5");
  const [screenshots, setScreenshots] = useState<SelectedScreenshot[]>([]);
  const [messages, setMessages] = useState<ParsedOfficerChatMessage[]>([]);
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      for (const shot of screenshots) {
        URL.revokeObjectURL(shot.previewUrl);
      }
    };
  }, [screenshots]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const res = await fetch("/api/officer-intel/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim() || t("defaultSessionTitle"),
        channelLabel: channelLabel.trim() || null,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { sessionId?: string; error?: string }
      | null;
    if (!res.ok || !body?.sessionId) {
      throw new Error(body?.error ?? t("createSessionFailed"));
    }
    setSessionId(body.sessionId);
    return body.sessionId;
  }, [channelLabel, sessionId, t, title]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: SelectedScreenshot[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      next.push({
        id: newScreenshotId(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (next.length === 0) return;
    setScreenshots((prev) => [...prev, ...next]);
    setError(null);
  }, []);

  const removeScreenshot = useCallback((id: string) => {
    setScreenshots((prev) => {
      const target = prev.find((shot) => shot.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((shot) => shot.id !== id);
    });
  }, []);

  const parseScreenshots = useCallback(async () => {
    if (screenshots.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureSession();
      const form = new FormData();
      for (const shot of screenshots) {
        form.append("images", shot.file);
      }
      const res = await fetch(`/api/officer-intel/sessions/${id}/parse`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as ParseResponse | null;
      if (!res.ok || !body?.messages || body.messages.length === 0) {
        throw new Error(body?.error ?? t("parseFailed"));
      }
      setMessages(body.messages);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("parseFailed"));
    } finally {
      setBusy(false);
    }
  }, [ensureSession, screenshots, t]);

  const updateMessage = useCallback(
    (index: number, patch: Partial<ParsedOfficerChatMessage>) => {
      setMessages((prev) =>
        prev.map((message, i) => (i === index ? { ...message, ...patch } : message)),
      );
    },
    [],
  );

  const removeMessage = useCallback((index: number) => {
    setMessages((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((message, sequenceOrder) => ({ ...message, sequenceOrder })),
    );
  }, []);

  const importMessages = useCallback(async () => {
    if (messages.length === 0 || screenshots.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const id = await ensureSession();
      const payload = {
        title: title.trim() || t("defaultSessionTitle"),
        channelLabel: channelLabel.trim() || null,
        messages: messages.map(
          (message): OfficerChatImportMessageInput => ({
            senderAllianceTag: message.senderAllianceTag,
            senderName: message.senderName,
            senderLevel: message.senderLevel,
            senderVipLevel: message.senderVipLevel,
            originalText: message.originalText,
            inGameTranslatedText: message.inGameTranslatedText,
            isReply: message.isReply,
            replyToName: message.replyToName,
            sequenceOrder: message.sequenceOrder,
            sourceImageIndex: message.sourceImageIndex,
          }),
        ),
      };
      const form = new FormData();
      form.set("payload", JSON.stringify(payload));
      for (const shot of screenshots) {
        form.append("images", shot.file);
      }
      const res = await fetch(`/api/officer-intel/sessions/${id}/import`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? t("importFailed"));
      }
      await onImported(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("importFailed"));
    } finally {
      setBusy(false);
    }
  }, [channelLabel, ensureSession, messages, onImported, screenshots, t, title]);

  const reviewSummary = useMemo(
    () => t("parsePreviewCount", { count: messages.length }),
    [messages.length, t],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-4 overflow-hidden p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-hq-fg">{t("uploadChat")}</h2>
            <p className="text-sm text-hq-muted">{t("uploadHint")}</p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-hq-muted hover:bg-hq-muted/10"
            onClick={onClose}
            aria-label={t("close")}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-hq-muted">{t("sessionTitle")}</span>
            <input
              className="rounded-lg border border-hq-border bg-hq-bg px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("defaultSessionTitle")}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-hq-muted">{t("channelLabel")}</span>
            <input
              className="rounded-lg border border-hq-border bg-hq-bg px-3 py-2"
              value={channelLabel}
              onChange={(e) => setChannelLabel(e.target.value)}
              placeholder={t("channelR4R5")}
            />
          </label>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {step === "upload" ? (
          <>
            <div className="flex flex-wrap gap-3">
              {screenshots.map((shot) => (
                <div
                  key={shot.id}
                  className="relative h-24 w-16 overflow-hidden rounded-lg border border-hq-border"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.previewUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white"
                    onClick={() => removeScreenshot(shot.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="flex h-24 w-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-hq-border text-hq-muted hover:bg-hq-muted/10"
                onClick={() => fileInputRef.current?.click()}
              >
                <PlusIcon />
                <span className="text-[10px]">{t("addScreenshots")}</span>
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <form
              onSubmit={(event) => {
                preventDefaultFormSubmit(event);
                void parseScreenshots();
              }}
            >
              <button
                type="submit"
                disabled={busy || screenshots.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {busy ? t("parsing") : t("parsePreview")}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-hq-muted">{reviewSummary}</p>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-hq-border">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 bg-hq-surface text-hq-muted">
                  <tr>
                    <th className="px-3 py-2">{t("sender")}</th>
                    <th className="px-3 py-2">{t("originalText")}</th>
                    <th className="px-3 py-2">{t("translatedText")}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message, index) => (
                    <tr key={`${message.sequenceOrder}-${index}`} className="border-t border-hq-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {message.senderAllianceTag
                          ? `[${message.senderAllianceTag}]`
                          : ""}
                        {message.senderName}
                      </td>
                      <td className="px-3 py-2">
                        <textarea
                          className="min-h-[4rem] w-full rounded border border-hq-border bg-hq-bg px-2 py-1"
                          value={message.originalText}
                          onChange={(e) =>
                            updateMessage(index, { originalText: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-hq-muted">
                        {message.inGameTranslatedText ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-hq-muted hover:text-red-500"
                          onClick={() => removeMessage(index)}
                          aria-label={t("removeMessage")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-hq-border px-4 py-2 text-sm"
                onClick={() => setStep("upload")}
                disabled={busy}
              >
                {t("backToUpload")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-hq-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={busy || messages.length === 0}
                onClick={() => void importMessages()}
              >
                {busy ? t("importing") : t("importSession")}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

function PlusIcon() {
  return <span className="text-lg leading-none">+</span>;
}
