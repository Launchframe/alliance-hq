import { createElement, type ComponentProps, type ElementType } from "react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { VsVideoEvidencePanel } from "./VsVideoEvidencePanel";
import type {
  VsVideoDraftForm,
  VsVideoEvidenceResponse,
} from "@/lib/vs-performance/video-evidence.shared";
import enMessages from "../../../messages/en-US.json";

type PanelProps = ComponentProps<typeof VsVideoEvidencePanel>;
type Controller = PanelProps["controller"];

const dailyCandidate = {
  kind: "daily_totals" as const,
  left: { server: 1203, tag: "LFgo", name: null },
  right: { server: 1236, tag: "TriV", name: null },
  day: 2,
  leftScore: "2241713380",
  rightScore: "2222858900",
  leftPoints: null,
  rightPoints: null,
  dayResults: [],
  ongoing: false,
  partial: false,
};

function response(
  over: Partial<Pick<VsVideoEvidenceResponse, "canAttach" | "canEditMatch" | "canProcessImage" | "canWriteScores">> = {},
): VsVideoEvidenceResponse {
  return {
    evidence: {
      recordedDate: "2026-09-29",
      period: "daily",
      version: 3,
      imageVersion: 2,
      requestedKind: "auto",
      status: "ready",
      fileName: "shot.png",
      candidate: dailyCandidate,
      errorCode: null,
      draft: null,
      appliedImageVersion: null,
      previewUrl: "/api/tools/video-upload/job/vs-evidence/image?imageVersion=2",
    },
    canEditMatch: true,
    canAttach: true,
    canWriteScores: true,
    canProcessImage: true,
    draftIsOwn: true,
    today: "2026-10-05",
    ashedLinked: false,
    canImportAshed: false,
    scoreSync: { status: "local", lastSyncedAt: null },
    scope: "scope:week",
    contextScope: "ctx",
    matchup: null,
    alliance: { tag: "LFgo", name: null, server: 1203 },
    ...over,
  };
}

const draftForm: VsVideoDraftForm = {
  source: "screenshot",
  kind: "daily_totals",
  basisImageVersion: 2,
  editOpponent: false,
  opponent: { server: null, tag: null, name: null },
  opponentScore: "",
  ourSide: "left",
  confirmSides: false,
  finalDay: false,
  day: 2,
  left: dailyCandidate.left,
  right: dailyCandidate.right,
  leftScore: "2241713380",
  rightScore: "2222858900",
  leftPoints: "",
  rightPoints: "",
  winners: ["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"],
  expectedMatchupVersion: 0,
  expectedDayVersions: {},
  dirtyFields: [],
};

function controllerFor(state: VsVideoEvidenceResponse): Controller {
  return {
    state,
    form: draftForm,
    includeResults: false,
    loaded: true,
    dirty: false,
    busy: false,
    errorCode: null,
    success: false,
    hasUnappliedEvidence: true,
    contextMatches: true,
  } as unknown as Controller;
}

function renderPanel(state: VsVideoEvidenceResponse, jobStatus = "complete") {
  const Provider = NextIntlClientProvider as ElementType;
  return renderToString(
    createElement(
      Provider,
      { locale: "en-US", messages: enMessages, timeZone: "UTC" },
      createElement(VsVideoEvidencePanel, {
        controller: controllerFor(state),
        jobStatus,
      }),
    ),
  );
}

describe("VsVideoEvidencePanel capability gating", () => {
  it("enables attach controls but disables review fields when canAttach && !canEditMatch", () => {
    const html = renderPanel(
      response({ canAttach: true, canEditMatch: false }),
    );
    expect(html).toContain('data-testid="vs-video-evidence-panel"');
    expect(html).toContain(
      "An alliance officer must review and save match results.",
    );
    const replace = html.match(/<button[^>]*>\s*Replace screenshot\s*<\/button>/);
    expect(replace?.[0]).toBeTruthy();
    expect(replace?.[0]).not.toContain('disabled=""');
    const remove = html.match(/<button[^>]*>\s*Remove screenshot\s*<\/button>/);
    expect(remove?.[0]).toBeTruthy();
    expect(remove?.[0]).not.toContain('disabled=""');
    const tagInput = html.match(
      /<input[^>]*aria-label="Left alliance Tag"[^>]*>/,
    );
    expect(tagInput?.[0]).toContain('disabled=""');
    const include = html.match(
      /<input[^>]*data-testid="vs-video-include-results"[^>]*>/,
    );
    if (include) expect(include[0]).toContain('disabled=""');
    expect(html).not.toContain('data-testid="vs-video-save-match"');
  });

  it("enables review fields and the match save when canEditMatch is true", () => {
    const html = renderPanel(response({ canAttach: true, canEditMatch: true }));
    expect(html).not.toContain(
      "An alliance officer must review and save match results.",
    );
    const tagInput = html.match(
      /<input[^>]*aria-label="Left alliance Tag"[^>]*>/,
    );
    expect(tagInput?.[0]).toBeTruthy();
    expect(tagInput?.[0]).not.toContain('disabled=""');
    expect(html).toContain('data-testid="vs-video-save-match"');
  });
});
