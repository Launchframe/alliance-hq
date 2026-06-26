"use client";

import { useCallback, useEffect, useState } from "react";

import {
  buildVideoReviewDraft,
  clearVideoReviewDraftFromStorage,
  type VideoReviewDraftForm,
  type VideoReviewDraftRow,
  writeVideoReviewDraftToStorage,
} from "@/lib/video/review-extract-draft.shared";

type Args = {
  jobId: string;
  viewMode: "review" | "event";
  enabled: boolean;
  rows: VideoReviewDraftRow[];
  form: VideoReviewDraftForm;
};

export function useVideoReviewExtractDraft({
  jobId,
  viewMode,
  enabled,
  rows,
  form,
}: Args) {
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [trackedKey, setTrackedKey] = useState(`${jobId}:${viewMode}`);

  const draftKey = `${jobId}:${viewMode}`;
  if (trackedKey !== draftKey) {
    // Reset draft state during render when the job/view changes. This is the
    // React-recommended way to reset state on a prop change (no effect, no
    // ref writes), and it converges because trackedKey is updated here.
    setTrackedKey(draftKey);
    setAutosaveReady(false);
    setDraftRestored(false);
    setDraftSavedAt(null);
  }

  const markAutosaveReady = useCallback((savedAt?: string | null) => {
    setAutosaveReady(true);
    if (savedAt) {
      setDraftSavedAt(savedAt);
    }
  }, []);

  const clearDraft = useCallback(() => {
    clearVideoReviewDraftFromStorage(jobId, viewMode);
    setDraftSavedAt(null);
    setDraftRestored(false);
  }, [jobId, viewMode]);

  const persistDraft = useCallback(() => {
    if (!enabled || !autosaveReady || rows.length === 0) return;
    const draft = buildVideoReviewDraft({
      jobId,
      viewMode,
      rows,
      form,
    });
    writeVideoReviewDraftToStorage(draft);
    setDraftSavedAt(draft.savedAt);
  }, [autosaveReady, enabled, form, jobId, rows, viewMode]);

  useEffect(() => {
    if (!enabled || !autosaveReady) return;
    const timer = window.setTimeout(() => {
      persistDraft();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [autosaveReady, enabled, persistDraft]);

  const commitDraft = useCallback(() => {
    persistDraft();
  }, [persistDraft]);

  return {
    draftRestored,
    setDraftRestored,
    draftSavedAt,
    markAutosaveReady,
    clearDraft,
    commitDraft,
  };
}
