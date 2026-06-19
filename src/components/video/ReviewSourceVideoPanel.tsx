"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

export type VideoSeekRequest = { seconds: number; nonce: number } | null;

type Props = {
  jobId: string;
  open: boolean;
  onClose: () => void;
  unavailable?: boolean;
  surface: "mobile" | "desktop";
  seekRequest?: VideoSeekRequest;
};

export function ReviewSourceVideoPanel({
  jobId,
  open,
  onClose,
  unavailable = false,
  surface,
  seekRequest = null,
}: Props) {
  const t = useTranslations("videoReview");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (open) return;
    const el = videoRef.current;
    if (!el) return;
    el.pause();
  }, [open]);

  useEffect(() => {
    if (!open || !seekRequest) return;
    const el = videoRef.current;
    if (!el) return;

    const seekTo = seekRequest.seconds;

    const applySeek = () => {
      try {
        el.currentTime = seekTo;
        void el.play().catch(() => undefined);
      } catch {
        // ignore seek failures (e.g. unbuffered range)
      }
    };

    if (el.readyState >= 1) {
      applySeek();
      return;
    }

    el.addEventListener("loadedmetadata", applySeek, { once: true });
    return () => el.removeEventListener("loadedmetadata", applySeek);
  }, [open, seekRequest]);

  if (surface === "mobile") {
    return (
      <div
        className={`md:hidden overflow-hidden transition-all duration-300 ease-out ${
          open ? "max-h-[50vh] w-full" : "max-h-0"
        }`}
      >
        <div className="flex h-[50vh] w-full flex-col bg-black">
          <PanelChrome label={t("previewVideo")} closeLabel={t("closePreview")} onClose={onClose} />
          <VideoBody
            videoRef={videoRef}
            jobId={jobId}
            unavailable={unavailable}
            unavailableLabel={t("previewUnavailable")}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`hidden shrink-0 overflow-hidden transition-all duration-300 ease-out md:block ${
        open ? "w-[min(50vw,28rem)]" : "w-0"
      }`}
    >
      <div className="sticky top-0 flex h-screen w-[min(50vw,28rem)] flex-col border-l border-[#30363d] bg-black">
        <PanelChrome label={t("previewVideo")} closeLabel={t("closePreview")} onClose={onClose} />
        <VideoBody
          videoRef={videoRef}
          jobId={jobId}
          unavailable={unavailable}
          unavailableLabel={t("previewUnavailable")}
        />
      </div>
    </div>
  );
}

function PanelChrome({
  label,
  closeLabel,
  onClose,
}: {
  label: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-[#30363d] bg-[#161b22] px-3 py-2">
      <span className="text-sm font-medium text-[#e6edf3]">{label}</span>
      <button
        type="button"
        onClick={onClose}
        className="rounded px-2 py-1 text-sm text-[#8b949e] hover:text-[#e6edf3]"
      >
        {closeLabel}
      </button>
    </div>
  );
}

function VideoBody({
  videoRef,
  jobId,
  unavailable,
  unavailableLabel,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  jobId: string;
  unavailable: boolean;
  unavailableLabel: string;
}) {
  if (unavailable) {
    return (
      <p className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-[#8b949e]">
        {unavailableLabel}
      </p>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <video
        ref={videoRef}
        src={`/api/tools/video-upload/${jobId}/video`}
        controls
        playsInline
        className="h-full w-full object-contain"
      />
    </div>
  );
}
