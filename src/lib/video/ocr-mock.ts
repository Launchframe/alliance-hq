import "server-only";

import fs from "node:fs";
import path from "node:path";

import { listAllianceMembers } from "@/lib/members/roster.server";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import type { OcrEntry } from "@/lib/video/normalize-rows";
import {
  collapseRosterMembersByNameRank,
  type ExtractedRosterMember,
} from "@/lib/video/roster-extract";

type MockScoreFixtureRow = {
  name: string;
  score: string | number;
  rank?: number;
};

type MockRosterFixtureRow = Omit<ExtractedRosterMember, "_sourceFrameIndex">;

function fixturesDir(): string {
  return path.join(process.cwd(), "src/lib/video/__ocr_fixtures__");
}

function loadJsonFixture<T>(fileName: string): T | null {
  const filePath = path.join(fixturesDir(), fileName);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function fixtureFileForScoreTarget(scoreTargetId: string): string {
  return `${scoreTargetId}.json`;
}

export async function mockOcrScoreFrames(
  scoreTargetId: string,
  frames: Array<{ index: number }>,
  options?: { allianceId?: string | null },
): Promise<OcrEntry[]> {
  const fixture =
    loadJsonFixture<MockScoreFixtureRow[]>(
      fixtureFileForScoreTarget(scoreTargetId),
    ) ??
    loadJsonFixture<MockScoreFixtureRow[]>("desert-storm.json") ??
    [];

  if (fixture.length > 0) {
    return fixture.map((row, index) => ({
      name: row.name,
      score: row.score,
      rank: row.rank ?? index + 1,
      _sourceFrameIndex: frames[0]?.index ?? 0,
    }));
  }

  if (options?.allianceId) {
    const members = await listAllianceMembers(options.allianceId);
    return members.slice(0, 25).map((member, index) => ({
      name: member.currentName ?? member.ashedMemberId,
      score: String(1_000_000 - index * 10_000),
      rank: index + 1,
      _sourceFrameIndex: frames[0]?.index ?? 0,
    }));
  }

  return [
    {
      name: "Mock Player One",
      score: "1000000",
      rank: 1,
      _sourceFrameIndex: frames[0]?.index ?? 0,
    },
    {
      name: "Mock Player Two",
      score: "900000",
      rank: 2,
      _sourceFrameIndex: frames[0]?.index ?? 0,
    },
  ];
}

export async function mockOcrRosterFrames(
  scoreTargetId: string,
  frames: Array<{ index: number }>,
  options?: { allianceId?: string | null },
): Promise<ExtractedRosterMember[]> {
  const targetId =
    scoreTargetId === MEMBER_ROSTER_VIDEO_SCORE_TARGET
      ? "member-roster-video"
      : scoreTargetId;

  const fixture =
    loadJsonFixture<MockRosterFixtureRow[]>(
      fixtureFileForScoreTarget(targetId),
    ) ??
    loadJsonFixture<MockRosterFixtureRow[]>("member-roster-video.json") ??
    [];

  const frameIndex = frames[0]?.index ?? 0;

  if (fixture.length > 0) {
    return collapseRosterMembersByNameRank(
      fixture.map((row) => ({
        ...row,
        _sourceFrameIndex: frameIndex,
      })),
    );
  }

  if (options?.allianceId) {
    const members = await listAllianceMembers(options.allianceId);
    return collapseRosterMembersByNameRank(
      members.slice(0, 30).map((member) => ({
        currentName: member.currentName ?? member.ashedMemberId,
        rosterRankRaw: member.allianceRank != null ? `R${member.allianceRank}` : null,
        allianceRank: member.allianceRank,
        allianceRankTitle: null,
        powerLevel: null,
        heroPowerM: null,
        memberLevel: null,
        profession: null,
        status: member.status ?? null,
        _sourceFrameIndex: frameIndex,
      })),
    );
  }

  return collapseRosterMembersByNameRank([
    {
      currentName: "Mock Roster One",
      rosterRankRaw: "R5",
      allianceRank: 5,
      allianceRankTitle: "Leader",
      powerLevel: "5.0M",
      heroPowerM: 5,
      memberLevel: 90,
      profession: null,
      status: null,
      _sourceFrameIndex: frameIndex,
    },
  ]);
}
