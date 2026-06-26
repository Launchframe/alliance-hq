"use client";

import { useCallback, useEffect, useState } from "react";

import {
  buildVideoReviewDraft,
  clearVideoReviewDraftFromStorage,
  shouldAutosaveVideoReviewDraft,
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
  dirtyVersion: number;
};

export function useVideoReviewExtractDraft({
  jobId,
  viewMode,
  enabled,
  rows,
  form,
  dirtyVersion,
}: Args) {
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [autosaveReady, setAutosaveReady] = useState(false);
  const [baselineDirtyVersion, setBaselineDirtyVersion] = useState(dirtyVersion);
  const [trackedKey, setTrackedKey] = useState(`${jobId}:${viewMode}`);

  const draftKey = `${jobId}:${viewMode}`;
  if (trackedKey !== draftKey) {
    // Reset draft state during render when the job/view changes. This is the
    // React-recommended way to reset state on a prop change (no effect, no
    // ref writes), and it converges because trackedKey is updated here.
    setTrackedKey(draftKey);
    setAutosaveReady(false);
    setBaselineDirtyVersion(dirtyVersion);
    setDraftRestored(false);
    setDraftSavedAt(null);
  }

  const markAutosaveReady = useCallback(
    (baseline: number, savedAt?: string | null) => {
      setBaselineDirtyVersion(baseline);
      setAutosaveReady(true);
      if (savedAt) {
        setDraftSavedAt(savedAt);
      }
    },
    [],
  );

  const clearDraft = useCallback(() => {
    clearVideoReviewDraftFromStorage(jobId, viewMode);
    setAutosaveReady(false);
    setBaselineDirtyVersion(dirtyVersion);
    setDraftSavedAt(null);
    setDraftRestored(false);
  }, [dirtyVersion, jobId, viewMode]);

  const persistDraft = useCallback(() => {
    if (
      !shouldAutosaveVideoReviewDraft({
        enabled,
        autosaveReady,
        dirtyVersion,
        baselineDirtyVersion,
        rowCount: rows.length,
      })
    ) {
      return;
    }
    const draft = buildVideoReviewDraft({
      jobId,
      viewMode,
      rows,
      form,
    });
    writeVideoReviewDraftToStorage(draft);
    setDraftSavedAt(draft.savedAt);
    setBaselineDirtyVersion(dirtyVersion);
  }, [
    autosaveReady,
    baselineDirtyVersion,
    dirtyVersion,
    enabled,
    form,
    jobId,
    rows,
    viewMode,
  ]);

  useEffect(() => {
    if (
      !shouldAutosaveVideoReviewDraft({
        enabled,
        autosaveReady,
        dirtyVersion,
        baselineDirtyVersion,
        rowCount: rows.length,
      })
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistDraft();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    autosaveReady,
    baselineDirtyVersion,
    dirtyVersion,
    enabled,
    persistDraft,
    rows.length,
  ]);

  return {
    draftRestored,
    setDraftRestored,
    draftSavedAt,
    markAutosaveReady,
    clearDraft,
  };
}
