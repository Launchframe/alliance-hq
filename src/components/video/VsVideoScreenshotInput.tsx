"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { MAX_SCREENSHOT_UPLOAD_BYTES } from "@/lib/ocr/screenshot-upload.shared";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg"]);

export function validateVsVideoScreenshotFile(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) return "invalid_file_type";
  if (file.size <= 0 || file.size > MAX_SCREENSHOT_UPLOAD_BYTES) {
    return "invalid_file_size";
  }
  return null;
}

export function VsVideoScreenshotInput(props: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const t = useTranslations("vsPerformance.videoEvidence");
  const tCapture = useTranslations("vsPerformance.capture");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [invalidFile, setInvalidFile] = useState(false);

  const previewUrl = useMemo(
    () =>
      props.file && !invalidFile ? URL.createObjectURL(props.file) : null,
    [props.file, invalidFile],
  );
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const accept = (file: File | null) => {
    if (!file) return;
    if (validateVsVideoScreenshotFile(file) !== null) {
      setInvalidFile(true);
      return;
    }
    setInvalidFile(false);
    props.onChange(file);
  };

  return (
    <div className="mt-4">
      <span className="mb-2 block text-sm text-hq-fg-muted">
        {t("attachmentLabel")}
      </span>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!props.disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          if (props.disabled) return;
          accept(event.dataTransfer.files?.[0] ?? null);
        }}
        className={`rounded-xl border border-dashed p-4 ${
          dragOver ? "border-hq-accent bg-hq-surface-muted" : "border-hq-border"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          disabled={props.disabled}
          className="sr-only"
          aria-label={t("attachmentLabel")}
          onChange={(event) => {
            accept(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        {props.file ? (
          <div className="flex flex-wrap items-center gap-3">
            {previewUrl ? (
              <Image
                src={previewUrl}
                alt={t("previewAlt")}
                width={96}
                height={96}
                unoptimized
                className="h-24 w-24 rounded-lg border border-hq-border object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <p className="truncate text-sm">{props.file.name}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg border border-hq-border px-3 py-1 text-xs text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
                >
                  {t("replaceScreenshot")}
                </button>
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => props.onChange(null)}
                  className="rounded-lg border border-hq-border px-3 py-1 text-xs text-hq-danger hover:bg-hq-surface-muted disabled:opacity-50"
                >
                  {t("removeScreenshot")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={props.disabled}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-hq-border px-3 py-1.5 text-sm text-hq-fg hover:bg-hq-surface-muted disabled:opacity-50"
          >
            {t("addScreenshot")}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-hq-fg-muted">{t("attachmentHint")}</p>
      {invalidFile ? (
        <p className="mt-1 text-xs text-hq-danger">{tCapture("imageHint")}</p>
      ) : null}
      {props.error ? (
        <p className="mt-1 text-xs text-hq-danger" role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
