"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getVsVideoEvidence,
  patchVsVideoEvidence,
  processVsVideoEvidence,
  removeVsVideoScreenshot,
  saveVsVideoMatch,
  syncVsVideoEvidence,
  uploadVsVideoScreenshot,
  VsVideoClientError,
} from "@/lib/video/client-vs-evidence";
import {
  buildVsVideoMatchSubmission,
  chooseVsVideoSide,
  hasVsVideoOpponent,
  mergeVsVideoCandidate,
  seedVsVideoDraftForm,
} from "@/lib/vs-performance/video-evidence-review.shared";
import {
  vsVideoWeekStart,
  type VsVideoContext,
  type VsVideoDraftForm,
  type VsVideoEvidenceResponse,
  type VsVideoMatchSubmission,
  type VsVideoRequestedKind,
} from "@/lib/vs-performance/video-evidence.shared";

type DirtyField = VsVideoDraftForm["dirtyFields"][number];

type FormStringField =
  | "opponentScore"
  | "leftScore"
  | "rightScore"
  | "leftPoints"
  | "rightPoints";

type Epoch = {
  id: number;
  jobId: string;
  context: VsVideoContext;
  controller: AbortController;
};

function contextOf(response: VsVideoEvidenceResponse): VsVideoContext {
  return {
    recordedDate: response.evidence.recordedDate,
    period: response.evidence.period,
  };
}

function sameContext(a: VsVideoContext, b: VsVideoContext): boolean {
  return a.recordedDate === b.recordedDate && a.period === b.period;
}

export function useVsVideoEvidence(input: {
  jobId: string;
  enabled: boolean;
  context: VsVideoContext;
  jobStatus: string;
  locale: string;
  submitting?: boolean;
  onMatchSaved?: () => void;
}) {
  const { jobId, enabled, context, jobStatus, locale, submitting } = input;
  const [state, setState] = useState<VsVideoEvidenceResponse | null>(null);
  const [form, setForm] = useState<VsVideoDraftForm | null>(null);
  const [includeResults, setIncludeResultsState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(0);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const stateRef = useRef<VsVideoEvidenceResponse | null>(null);
  const formRef = useRef<VsVideoDraftForm | null>(null);
  const includeRef = useRef(false);
  const editRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const latestVersionRef = useRef(-1);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveBlockedRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const epochRef = useRef<Epoch>({
    id: 0,
    jobId,
    context,
    controller: new AbortController(),
  });
  const requestedContextRef = useRef(context);
  const processedGenerationsRef = useRef<Set<number>>(new Set());
  const ashedPrefillScopeRef = useRef<string | null>(null);
  const submittingRef = useRef(Boolean(submitting));
  const reloadRef = useRef<(() => Promise<void>) | null>(null);
  const onMatchSavedRef = useRef(input.onMatchSaved);

  useEffect(() => {
    requestedContextRef.current = context;
    submittingRef.current = Boolean(submitting);
    onMatchSavedRef.current = input.onMatchSaved;
  }, [context, submitting, input.onMatchSaved]);

  const applyForm = useCallback((next: VsVideoDraftForm | null) => {
    formRef.current = next;
    setForm(next);
  }, []);

  const applyInclude = useCallback((next: boolean) => {
    includeRef.current = next;
    setIncludeResultsState(next);
  }, []);

  const isCurrent = useCallback(
    (epoch: Epoch, signal?: AbortSignal) =>
      epochRef.current === epoch &&
      !epoch.controller.signal.aborted &&
      (signal == null || !signal.aborted),
    [],
  );

  const resetAll = useCallback(
    (epoch: Epoch) => {
      epochRef.current = epoch;
      stateRef.current = null;
      latestVersionRef.current = -1;
      editRevisionRef.current = 0;
      persistedRevisionRef.current = 0;
      autosaveBlockedRef.current = false;
      processedGenerationsRef.current.clear();
      ashedPrefillScopeRef.current = null;
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setState(null);
      applyForm(null);
      applyInclude(false);
      setLoaded(false);
      setErrorCode(null);
      setSuccess(false);
      setBusy(0);
    },
    [applyForm, applyInclude],
  );

  const startEpoch = useCallback(
    (next: VsVideoContext) => {
      const previous = epochRef.current;
      previous.controller.abort();
      const epoch: Epoch = {
        id: previous.id + 1,
        jobId,
        context: next,
        controller: new AbortController(),
      };
      resetAll(epoch);
      return epoch;
    },
    [jobId, resetAll],
  );

  const hydrateResponse = useCallback(
    (response: VsVideoEvidenceResponse) => {
      latestVersionRef.current = response.evidence.version;
      stateRef.current = response;
      setState(response);
      setLoaded(true);
      const serverDraft = response.evidence.draft;
      const draftForm = serverDraft?.form ?? null;
      if (
        draftForm &&
        draftForm.basisImageVersion === response.evidence.imageVersion
      ) {
        const restored: VsVideoDraftForm = { ...draftForm };
        if (!response.draftIsOwn) {
          restored.confirmSides = false;
          restored.finalDay = false;
          applyInclude(false);
        } else {
          applyInclude(serverDraft?.includeResults ?? false);
        }
        applyForm(restored);
      } else {
        applyInclude(false);
        applyForm(seedVsVideoDraftForm(response));
      }
      persistedRevisionRef.current = editRevisionRef.current;
    },
    [applyForm, applyInclude],
  );

  const ingestResponse = useCallback(
    (
      epoch: Epoch,
      response: VsVideoEvidenceResponse,
      options?: { passive?: boolean },
    ): boolean => {
      if (!isCurrent(epoch)) return false;
      const previousScope = stateRef.current?.contextScope ?? null;
      if (
        previousScope !== null &&
        previousScope !== response.contextScope
      ) {
        startEpoch(contextOf(response));
        requestedContextRef.current = contextOf(response);
        hydrateResponse(response);
        return true;
      }
      if (response.evidence.version < latestVersionRef.current) return false;
      const local = formRef.current;
      const localDirty = local != null && local.dirtyFields.length > 0;
      const foreignScope = !sameContext(
        contextOf(response),
        requestedContextRef.current,
      );
      const foreignGeneration =
        local != null &&
        response.evidence.imageVersion !== local.basisImageVersion;
      if (
        options?.passive &&
        localDirty &&
        (foreignScope || foreignGeneration)
      ) {
        setErrorCode("stale");
        autosaveBlockedRef.current = true;
        return false;
      }
      latestVersionRef.current = response.evidence.version;
      stateRef.current = response;
      setState(response);
      setLoaded(true);
      if (!localDirty) {
        const serverDraft = response.evidence.draft;
        const draftForm = serverDraft?.form ?? null;
        if (
          draftForm &&
          draftForm.basisImageVersion === response.evidence.imageVersion
        ) {
          const restored: VsVideoDraftForm = { ...draftForm };
          if (!response.draftIsOwn) {
            restored.confirmSides = false;
            restored.finalDay = false;
            applyInclude(false);
          } else {
            applyInclude(serverDraft?.includeResults ?? false);
          }
          applyForm(restored);
        } else {
          applyInclude(false);
          applyForm(seedVsVideoDraftForm(response));
        }
        persistedRevisionRef.current = editRevisionRef.current;
      } else {
        applyForm(mergeVsVideoCandidate(local, response));
      }
      return true;
    },
    [applyForm, applyInclude, hydrateResponse, isCurrent, startEpoch],
  );

  const captureEpoch = useCallback(() => epochRef.current.id, []);

  const ingest = useCallback(
    (response: VsVideoEvidenceResponse, issuedEpoch?: number) => {
      if (issuedEpoch != null && issuedEpoch !== epochRef.current.id) return;
      ingestResponse(epochRef.current, response, { passive: true });
    },
    [ingestResponse],
  );

  const markEdited = useCallback(() => {
    editRevisionRef.current += 1;
    setSuccess(false);
  }, []);

  const enqueue = useCallback(
    <T>(task: () => Promise<T>): Promise<T> => {
      const run = chainRef.current.then(task);
      chainRef.current = run.catch(() => undefined);
      return run;
    },
    [],
  );

  const flushDraft = useCallback(async (force = false): Promise<void> => {
    const epoch = epochRef.current;
    const snapshot = stateRef.current;
    const draftForm = formRef.current;
    if (
      !snapshot ||
      !draftForm ||
      !snapshot.canEditMatch ||
      autosaveBlockedRef.current ||
      editRevisionRef.current === persistedRevisionRef.current ||
      (!force && submittingRef.current)
    ) {
      return;
    }
    const revision = editRevisionRef.current;
    const body: {
      expectedVersion: number;
      context?: VsVideoContext;
      draft: {
        includeResults: boolean;
        submission: null;
        form: VsVideoDraftForm;
      };
    } = {
      expectedVersion: snapshot.evidence.version,
      draft: {
        includeResults: includeRef.current,
        submission: null,
        form: draftForm,
      },
    };
    if (snapshot.evidence.version === 0) {
      body.context = contextOf(snapshot);
    }
    try {
      const response = await patchVsVideoEvidence(
        jobId,
        body,
        epoch.controller.signal,
      );
      if (!isCurrent(epoch)) return;
      if (revision === editRevisionRef.current) {
        persistedRevisionRef.current = revision;
        ingestResponse(epoch, response);
      } else if (response.evidence.version >= latestVersionRef.current) {
        latestVersionRef.current = response.evidence.version;
        stateRef.current = response;
        setState(response);
      }
    } catch (error) {
      if (isCurrent(epoch)) {
        if (error instanceof VsVideoClientError) {
          if (error.code === "stale") {
            autosaveBlockedRef.current = true;
            void reloadRef.current?.();
          }
          setErrorCode(error.code);
        } else if (
          !(error instanceof Error && error.name === "AbortError")
        ) {
          setErrorCode("network");
        }
      }
      throw error;
    }
  }, [ingestResponse, isCurrent, jobId]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void enqueue(() => flushDraft()).catch(() => undefined);
    }, 500);
  }, [enqueue, flushDraft]);

  const requestKey = `${jobId}:${enabled ? 1 : 0}`;

  useEffect(() => {
    if (!enabled) return;
    const epoch = epochRef.current;
    if (epoch.jobId !== jobId || epoch.controller.signal.aborted) {
      startEpoch(requestedContextRef.current);
    }
    const active = epochRef.current;
    getVsVideoEvidence(jobId, active.controller.signal)
      .then((response) => {
        ingestResponse(active, response, { passive: true });
      })
      .catch((error) => {
        if (!isCurrent(active)) return;
        setLoaded(true);
        if (error instanceof VsVideoClientError) {
          setErrorCode(error.code);
        } else if (!(error instanceof Error && error.name === "AbortError")) {
          setErrorCode("network");
        }
      });
  }, [enabled, ingestResponse, isCurrent, jobId, startEpoch, requestKey]);

  useEffect(() => {
    const epoch = epochRef.current;
    return () => {
      epoch.controller.abort();
    };
  }, [jobId]);

  useEffect(() => {
    if (!enabled || !state) return;
    const videoPending = ["pending_upload", "pending_approval"].includes(
      jobStatus,
    );
    const status = state.evidence.status;
    const processing =
      !videoPending && (status === "queued" || status === "running");
    const syncPending =
      state.ashedLinked &&
      (state.scoreSync.status === "pending" ||
        state.matchup?.sync?.status === "pending");
    if (!processing && !syncPending) return;
    const intervalMs = processing ? 2000 : 5000;
    const epoch = epochRef.current;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      getVsVideoEvidence(jobId, epoch.controller.signal)
        .then((response) =>
          ingestResponse(epoch, response, { passive: true }),
        )
        .catch(() => undefined);
    };
    const timer = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, ingestResponse, jobId, jobStatus, state]);

  useEffect(() => {
    if (!enabled || !state) return;
    if (!state.canProcessImage || state.evidence.status !== "queued") return;
    const generation = state.evidence.imageVersion;
    const epoch = epochRef.current;
    const key = epoch.id * 1_000_000 + generation;
    if (processedGenerationsRef.current.has(key)) return;
    processedGenerationsRef.current.add(key);
    void processVsVideoEvidence(jobId, epoch.controller.signal)
      .then((response) => {
        ingestResponse(epoch, response, { passive: true });
      })
      .catch(() => undefined);
  }, [enabled, ingestResponse, jobId, state]);

  useEffect(() => {
    if (!enabled || !state) return;
    if (!state.canEditMatch || !state.canImportAshed) return;
    if (hasVsVideoOpponent(state)) return;
    if (formRef.current != null && formRef.current.dirtyFields.length > 0) {
      return;
    }
    const scope = `${state.scope}:${state.evidence.recordedDate}`;
    if (ashedPrefillScopeRef.current === scope) return;
    ashedPrefillScopeRef.current = scope;
    const epoch = epochRef.current;
    void fetch("/api/vs-performance/matchup/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: epoch.controller.signal,
      body: JSON.stringify({
        weekStart: vsVideoWeekStart(state.evidence),
        scope: state.scope,
        reason: "auto",
      }),
    })
      .then((res) => {
        if (!res.ok) {
          if (isCurrent(epoch) && !epoch.controller.signal.aborted) {
            setErrorCode("network");
          }
          return null;
        }
        return getVsVideoEvidence(jobId, epoch.controller.signal).then(
          (response) => ingestResponse(epoch, response, { passive: true }),
        );
      })
      .catch((error) => {
        if (
          isCurrent(epoch) &&
          !(error instanceof Error && error.name === "AbortError")
        ) {
          setErrorCode("network");
        }
      });
  }, [enabled, ingestResponse, isCurrent, jobId, state]);

  const runMutation = useCallback(
    async (
      task: (signal: AbortSignal) => Promise<VsVideoEvidenceResponse>,
      options?: {
        onSuccess?: (response: VsVideoEvidenceResponse) => void;
        resetReview?: boolean;
      },
    ): Promise<VsVideoEvidenceResponse | null> => {
      const epoch = epochRef.current;
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setBusy((count) => count + 1);
      setErrorCode(null);
      try {
        const response = await enqueue(() => task(epoch.controller.signal));
        if (ingestResponse(epoch, response)) {
          if (options?.resetReview) {
            applyForm(seedVsVideoDraftForm(response));
            applyInclude(false);
            persistedRevisionRef.current = editRevisionRef.current;
          }
          autosaveBlockedRef.current = false;
          options?.onSuccess?.(response);
        }
        return isCurrent(epoch) ? response : null;
      } catch (error) {
        if (isCurrent(epoch)) {
          if (error instanceof VsVideoClientError) {
            if (error.code === "stale") autosaveBlockedRef.current = true;
            setErrorCode(error.code);
          } else if (
            !(error instanceof Error && error.name === "AbortError")
          ) {
            setErrorCode("network");
          }
        }
        return null;
      } finally {
        setBusy((count) => Math.max(0, count - 1));
      }
    },
    [applyForm, applyInclude, enqueue, ingestResponse, isCurrent],
  );

  const reload = useCallback(async () => {
    const epoch = epochRef.current;
    setBusy((count) => count + 1);
    try {
      const response = await enqueue(() =>
        getVsVideoEvidence(jobId, epoch.controller.signal),
      );
      if (!isCurrent(epoch)) return;
      latestVersionRef.current = response.evidence.version;
      stateRef.current = response;
      setState(response);
      setLoaded(true);
      const local = formRef.current;
      if (local && local.dirtyFields.length > 0) {
        const fresh = seedVsVideoDraftForm(response);
        applyForm({
          ...local,
          expectedMatchupVersion: fresh.expectedMatchupVersion,
          expectedDayVersions: fresh.expectedDayVersions,
        });
      } else {
        ingestResponse(epoch, response);
      }
      autosaveBlockedRef.current = false;
      setErrorCode(null);
      const localNow = formRef.current;
      if (localNow && localNow.dirtyFields.length > 0) {
        scheduleAutosave();
      }
    } catch (error) {
      if (!isCurrent(epoch)) return;
      if (error instanceof VsVideoClientError) {
        setErrorCode(error.code);
      } else if (!(error instanceof Error && error.name === "AbortError")) {
        setErrorCode("network");
      }
    } finally {
      setBusy((count) => Math.max(0, count - 1));
    }
  }, [applyForm, enqueue, ingestResponse, isCurrent, jobId, scheduleAutosave]);

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const setField = useCallback(
    (key: DirtyField | "editOpponent", value: unknown) => {
      const local = formRef.current;
      if (!local) return;
      const dirty = new Set(local.dirtyFields);
      const next: VsVideoDraftForm = { ...local };
      if (key === "editOpponent") {
        next.editOpponent = value === true;
        dirty.add("opponent");
      } else if (key === "opponent") {
        next.opponent = { ...local.opponent, ...(value as object) };
        dirty.add("opponent");
      } else if (key === "left" || key === "right") {
        next[key] = { ...local[key], ...(value as object) };
        dirty.add(key);
      } else if (key === "winners") {
        next.winners = value as VsVideoDraftForm["winners"];
        dirty.add("winners");
      } else if (key === "confirmSides" || key === "finalDay") {
        next[key] = value === true;
        dirty.add(key);
      } else if (key === "day") {
        next.day = value as VsVideoDraftForm["day"];
        dirty.add("day");
      } else {
        next[key as FormStringField] = value as string;
        dirty.add(key);
      }
      next.dirtyFields = [...dirty];
      applyForm(next);
      markEdited();
      scheduleAutosave();
    },
    [applyForm, markEdited, scheduleAutosave],
  );

  const setIncludeResults = useCallback(
    (next: boolean) => {
      applyInclude(next);
      markEdited();
      scheduleAutosave();
    },
    [applyInclude, markEdited, scheduleAutosave],
  );

  const chooseSide = useCallback(
    (side: "left" | "right") => {
      const response = stateRef.current;
      const local = formRef.current;
      if (!response || !local) return;
      applyForm(chooseVsVideoSide(local, response, side));
      markEdited();
      scheduleAutosave();
    },
    [applyForm, markEdited, scheduleAutosave],
  );

  const changeContext = useCallback(
    async (next: VsVideoContext) => {
      const epoch = epochRef.current;
      const response = await runMutation(
      (signal) =>
        patchVsVideoEvidence(
          jobId,
          {
            expectedVersion: stateRef.current?.evidence.version ?? 0,
            context: next,
          },
          signal,
        ),
      { resetReview: true },
    );
      if (!response) return false;
      epoch.context = contextOf(response);
      return true;
    },
    [jobId, runMutation],
  );

  const upload = useCallback(
    async (file: File) => {
      const epoch = epochRef.current;
      const kind: VsVideoRequestedKind =
        stateRef.current?.evidence.requestedKind ?? "auto";
      const response = await runMutation(
        (signal) =>
          uploadVsVideoScreenshot(
            jobId,
            file,
            stateRef.current?.evidence.version ?? 0,
            kind,
            signal,
          ),
        { resetReview: true },
      );
      if (response == null && isCurrent(epoch)) {
        try {
          const fresh = await enqueue(() =>
            getVsVideoEvidence(jobId, epoch.controller.signal),
          );
          if (!isCurrent(epoch)) return;
          const local = formRef.current;
          const generationChanged =
            fresh.evidence.imageVersion !==
            stateRef.current?.evidence.imageVersion;
          latestVersionRef.current = fresh.evidence.version;
          stateRef.current = fresh;
          setState(fresh);
          if (generationChanged || !local || local.dirtyFields.length === 0) {
            applyForm(seedVsVideoDraftForm(fresh));
            applyInclude(false);
          }
        } catch {
          return;
        }
      }
    },
    [applyForm, applyInclude, enqueue, isCurrent, jobId, runMutation],
  );

  const remove = useCallback(async () => {
    await runMutation(
      (signal) =>
        removeVsVideoScreenshot(
          jobId,
          stateRef.current?.evidence.version ?? 0,
          signal,
        ),
      { resetReview: true },
    );
  }, [jobId, runMutation]);

  const changeKind = useCallback(
    async (kind: VsVideoRequestedKind) => {
      await runMutation(
        (signal) =>
          patchVsVideoEvidence(
            jobId,
            {
              expectedVersion: stateRef.current?.evidence.version ?? 0,
              requestedKind: kind,
            },
            signal,
          ),
        { resetReview: true },
      );
    },
    [jobId, runMutation],
  );

  const retryProcessing = useCallback(async () => {
    const epoch = epochRef.current;
    const snapshot = stateRef.current;
    if (snapshot) {
      processedGenerationsRef.current.delete(
        epoch.id * 1_000_000 + snapshot.evidence.imageVersion,
      );
    }
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setBusy((count) => count + 1);
    setErrorCode(null);
    try {
      const response = await processVsVideoEvidence(
        jobId,
        epoch.controller.signal,
      );
      if (ingestResponse(epoch, response)) {
        const local = formRef.current;
        applyInclude(false);
        if (local && local.dirtyFields.length > 0) {
          applyForm({ ...local, confirmSides: false, finalDay: false });
          markEdited();
          scheduleAutosave();
        }
      }
    } catch (error) {
      if (isCurrent(epoch)) {
        if (error instanceof VsVideoClientError) {
          if (error.code === "stale") autosaveBlockedRef.current = true;
          setErrorCode(error.code);
        } else if (
          !(error instanceof Error && error.name === "AbortError")
        ) {
          setErrorCode("network");
        }
      }
    } finally {
      setBusy((count) => Math.max(0, count - 1));
    }
  }, [
    applyForm,
    applyInclude,
    ingestResponse,
    isCurrent,
    jobId,
    markEdited,
    scheduleAutosave,
  ]);

  const retrySync = useCallback(
    async (target: "scores" | "matchup") => {
      await runMutation((signal) => syncVsVideoEvidence(jobId, target, signal));
    },
    [jobId, runMutation],
  );

  const prepareSubmission = useCallback(
    async (options?: {
      forceInclude?: boolean;
    }): Promise<VsVideoMatchSubmission | undefined> => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const include = includeRef.current || options?.forceInclude === true;
      if (!include) {
        await enqueue(() => flushDraft(true)).catch(() => undefined);
        return undefined;
      }
      await enqueue(() => flushDraft(true));
      if (autosaveBlockedRef.current) {
        const error = new VsVideoClientError("stale", 409);
        setErrorCode("stale");
        throw error;
      }
      const response = stateRef.current;
      const draftForm = formRef.current;
      if (!response || !draftForm) return undefined;
      try {
        return buildVsVideoMatchSubmission(
          response,
          { includeResults: true, submission: null, form: draftForm },
          locale,
        );
      } catch (error) {
        setErrorCode(
          error instanceof Error && "code" in error
            ? String((error as { code: unknown }).code)
            : error instanceof Error
              ? error.message
              : "invalid",
        );
        throw error;
      }
    },
    [enqueue, flushDraft, locale],
  );

  const acceptSave = useCallback(
    (response?: VsVideoEvidenceResponse, matchResultsSaved = false) => {
      const epoch = epochRef.current;
      autosaveBlockedRef.current = false;
      if (!matchResultsSaved) {
        if (response) {
          ingestResponse(epoch, response, { passive: true });
        }
        return;
      }
      setSuccess(true);
      onMatchSavedRef.current?.();
      const apply = (next: VsVideoEvidenceResponse) => {
        const fullyApplied =
          next.evidence.draft === null ||
          (next.evidence.appliedImageVersion != null &&
            next.evidence.appliedImageVersion === next.evidence.imageVersion);
        const local = formRef.current;
        if (!isCurrent(epoch)) return;
        latestVersionRef.current = Math.max(
          latestVersionRef.current,
          next.evidence.version,
        );
        stateRef.current = next;
        setState(next);
        if (fullyApplied || !local || local.dirtyFields.length === 0) {
          applyForm(seedVsVideoDraftForm(next));
          applyInclude(false);
          persistedRevisionRef.current = editRevisionRef.current;
        } else {
          const fresh = seedVsVideoDraftForm(next);
          applyForm({
            ...local,
            expectedMatchupVersion: fresh.expectedMatchupVersion,
            expectedDayVersions: fresh.expectedDayVersions,
          });
        }
      };
      if (response) {
        apply(response);
        return;
      }
      void getVsVideoEvidence(jobId, epoch.controller.signal)
        .then((next) => apply(next))
        .catch(() => undefined);
    },
    [applyForm, applyInclude, ingestResponse, isCurrent, jobId],
  );

  const saveMatch = useCallback(
    async (requestId: string, submission: VsVideoMatchSubmission) => {
      const epoch = epochRef.current;
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      setBusy((count) => count + 1);
      setErrorCode(null);
      try {
        const response = await enqueue(() =>
          saveVsVideoMatch(
            jobId,
            { requestId, submission },
            epoch.controller.signal,
          ),
        );
        if (!isCurrent(epoch)) return null;
        acceptSave(response, true);
        return response;
      } catch (error) {
        if (isCurrent(epoch)) {
          if (error instanceof VsVideoClientError) {
            if (error.code === "stale") autosaveBlockedRef.current = true;
            setErrorCode(error.code);
          } else if (
            !(error instanceof Error && error.name === "AbortError")
          ) {
            setErrorCode("network");
          }
        }
        return null;
      } finally {
        setBusy((count) => Math.max(0, count - 1));
      }
    },
    [acceptSave, enqueue, isCurrent, jobId],
  );

  const cancelReview = useCallback(() => {
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const snapshot = stateRef.current;
    const local = formRef.current;
    if (!snapshot || !local) return;
    const matchup = snapshot.matchup;
    applyForm({
      ...local,
      opponent: matchup
        ? {
            server: matchup.opponentServer,
            tag: matchup.opponentTag,
            name: matchup.opponentName,
          }
        : { server: null, tag: null, name: null },
      editOpponent: false,
      dirtyFields: local.dirtyFields.filter((field) => field !== "opponent"),
    });
    markEdited();
    scheduleAutosave();
    setErrorCode(null);
  }, [applyForm, markEdited, scheduleAutosave]);

  const dirty = useMemo(
    () => (form?.dirtyFields.length ?? 0) > 0,
    [form],
  );

  const contextMatches = !state || sameContext(contextOf(state), context);

  const hasUnappliedEvidence = useMemo(() => {
    if (!state) return false;
    const evidence = state.evidence;
    const imagePending =
      evidence.fileName != null &&
      evidence.status !== "none" &&
      evidence.appliedImageVersion !== evidence.imageVersion;
    return imagePending || dirty;
  }, [dirty, state]);

  return {
    state,
    form,
    includeResults,
    loaded,
    dirty,
    busy: busy > 0,
    errorCode,
    success,
    hasUnappliedEvidence,
    contextMatches,
    captureEpoch,
    ingest,
    reload,
    setField,
    setIncludeResults,
    chooseSide,
    changeContext,
    upload,
    remove,
    changeKind,
    retryProcessing,
    retrySync,
    flushDraft,
    prepareSubmission,
    acceptSave,
    saveMatch,
    cancelReview,
  };
}
