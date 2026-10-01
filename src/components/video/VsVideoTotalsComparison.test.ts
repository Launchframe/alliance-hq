import { createElement, type ElementType } from "react";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import { VsVideoTotalsComparison } from "./VsVideoTotalsComparison";
import type {
  VsVideoDraftForm,
  VsVideoEvidenceResponse,
} from "@/lib/vs-performance/video-evidence.shared";
import type { VsCaptureCandidate } from "@/lib/vs-performance/vs-capture.shared";
import enMessages from "../../../messages/en-US.json";

const messages = {
  vsPerformance: { videoEvidence: enMessages.vsPerformance.videoEvidence },
};

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

function response(over: Partial<{
  candidate: VsCaptureCandidate | null;
  period: "daily" | "weekly";
  status: VsVideoEvidenceResponse["evidence"]["status"];
  fileName: string | null;
}> = {}): VsVideoEvidenceResponse {
  return {
    evidence: {
      recordedDate: "2026-09-29",
      period: over.period ?? "daily",
      version: 3,
      imageVersion: 2,
      requestedKind: "auto",
      status: over.status ?? "ready",
      fileName: over.fileName === undefined ? "shot.png" : over.fileName,
      candidate: over.candidate === undefined ? dailyCandidate : over.candidate,
      errorCode: null,
      draft: null,
      appliedImageVersion: null,
      previewUrl: null,
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
  };
}

function form(over: Partial<VsVideoDraftForm> = {}): VsVideoDraftForm {
  return {
    source: "screenshot",
    kind: "daily_totals",
    basisImageVersion: 2,
    editOpponent: false,
    opponent: { server: null, tag: null, name: null },
    opponentScore: "",
    ourSide: "left",
    confirmSides: true,
    finalDay: true,
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
    ...over,
  };
}

function render(props: {
  state?: VsVideoEvidenceResponse | null;
  form?: VsVideoDraftForm | null;
  scores?: readonly unknown[];
  complete?: boolean;
  contextMatches?: boolean;
}) {
  const Provider = NextIntlClientProvider as ElementType;
  return renderToString(
    createElement(
      Provider,
      { locale: "en-US", messages, timeZone: "UTC" },
      createElement(VsVideoTotalsComparison, {
        state: props.state ?? response(),
        form: props.form === undefined ? form() : props.form,
        locale: "en-US",
        scores: props.scores ?? ["2241713380"],
        complete: props.complete ?? true,
        contextMatches: props.contextMatches ?? true,
      }),
    ),
  );
}

describe("VsVideoTotalsComparison SSR", () => {
  it("renders the three read-only rows with no inputs", () => {
    const html = render({});
    expect(html).toContain('data-testid="vs-video-comparison"');
    expect(html).toContain('data-state="match"');
    expect(html).toContain("Total score from screenshot");
    expect(html).toContain("Total from scoreboard video");
    expect(html).toContain("Mean error");
    expect(html).toContain("Totals match.");
    expect(html).toContain("2,241,713,380");
    expect(html).not.toContain("<input");
  });

  it("floors sub-1% differences to 0% while keeping fine severity", () => {
    const html = render({
      form: form({ leftScore: "200" }),
      scores: ["199"],
    });
    expect(html).toContain('data-state="fine"');
    expect(html).toContain("Close enough");
    expect(html).toContain("0%");
  });

  it("warns at exactly 1% and hits danger at exactly 5%", () => {
    const warning = render({
      form: form({ leftScore: "100" }),
      scores: ["99"],
    });
    expect(warning).toContain('data-state="warning"');
    expect(warning).toContain("Slightly different");
    expect(warning).toContain("1%");
    const danger = render({
      form: form({ leftScore: "100" }),
      scores: ["95"],
    });
    expect(danger).toContain('data-state="danger"');
    expect(danger).toContain("missing some rows");
    expect(danger).toContain("5%");
  });

  it("uses the excess copy when the video total overshoots", () => {
    const html = render({
      form: form({ leftScore: "100" }),
      scores: ["110"],
    });
    expect(html).toContain('data-state="danger"');
    expect(html).toContain("extra or duplicate rows");
  });

  it("shows the zero-reference message instead of a fake percent", () => {
    const html = render({
      form: form({ leftScore: "0" }),
      scores: ["42"],
    });
    expect(html).toContain('data-state="danger"');
    expect(html).toContain("screenshot total is zero");
    const zeros = render({
      form: form({ leftScore: "0" }),
      scores: ["0"],
    });
    expect(zeros).toContain('data-state="match"');
    expect(zeros).toContain("Totals match.");
  });

  it("hides without an image, for weekly evidence, or on context mismatch", () => {
    expect(
      render({ state: response({ fileName: null, candidate: null }) }),
    ).toBe("");
    const weekly = response({
      candidate: { ...dailyCandidate, kind: "weekly_overview" },
    });
    expect(
      render({
        state: weekly,
        form: form({ kind: "weekly_overview" }),
      }),
    ).toBe("");
    expect(render({ contextMatches: false })).toBe("");
  });

  it("marks incomplete rows instead of blocking", () => {
    const html = render({ complete: false });
    expect(html).toContain('data-state="incomplete"');
    expect(html).toContain("unavailable while player rows are incomplete");
  });
});
