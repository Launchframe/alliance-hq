import { describe, expect, it } from "vitest";

import type { AshedMember } from "@/lib/video/member-matcher";

import {
  consumeGreedyMemberNames,
  parsePairingImportText,
  previewPairingImport,
} from "./pairing-import.shared";
import { buildMemberIndex } from "@/lib/video/member-matcher";

const members: AshedMember[] = [
  { id: "ashed-wl", current_name: "Bat Pig", status: "active" },
  { id: "ashed-eg", current_name: "EG Sie", status: "active" },
  { id: "ashed-fred", current_name: "Freddy", previous_names: ["Fred"], status: "active" },
  { id: "ashed-solo", current_name: "Nova", status: "active" },
];

describe("parsePairingImportText", () => {
  it("splits War Leader before the first colon and Engineers after", () => {
    const lines = parsePairingImportText(
      "Bat Pig: EG Sie Freddy\n\nNova: Fred\n",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      wlRaw: "Bat Pig",
      engRemainder: "EG Sie Freddy",
    });
    expect(lines[1]).toMatchObject({
      wlRaw: "Nova",
      engRemainder: "Fred",
    });
  });

  it("flags lines without a colon", () => {
    expect(parsePairingImportText("Bat Pig EG Sie")[0]?.issue).toBe(
      "missing_colon",
    );
  });

  it("splits on a hyphen delimiter instead of a colon", () => {
    const lines = parsePairingImportText("Bat Pig - EG Sie Freddy");
    expect(lines[0]).toMatchObject({
      wlRaw: "Bat Pig",
      engRemainder: "EG Sie Freddy",
    });
  });

  it("splits on a hyphen without surrounding spaces", () => {
    const lines = parsePairingImportText("Nova-Freddy");
    expect(lines[0]).toMatchObject({
      wlRaw: "Nova",
      engRemainder: "Freddy",
    });
  });

  it("prefers the first colon when the War Leader name contains a hyphen", () => {
    const lines = parsePairingImportText("Bat-Pig: Freddy");
    expect(lines[0]).toMatchObject({
      wlRaw: "Bat-Pig",
      engRemainder: "Freddy",
    });
  });

  it("uses a spaced hyphen when the War Leader name contains hyphens", () => {
    const lines = parsePairingImportText("Bat-Pig - EG Sie Freddy");
    expect(lines[0]).toMatchObject({
      wlRaw: "Bat-Pig",
      engRemainder: "EG Sie Freddy",
    });
  });

  it("rejects multiple compact hyphens without a colon or spaced delimiter", () => {
    expect(parsePairingImportText("Bat-Pig-EG Sie")[0]?.issue).toBe(
      "missing_colon",
    );
  });
});

describe("consumeGreedyMemberNames", () => {
  const index = buildMemberIndex(members);

  it("keeps multi-token Engineer names together", () => {
    const hits = consumeGreedyMemberNames("EG Sie Freddy", index);
    expect(hits.map((h) => h.match.memberId)).toEqual(["ashed-eg", "ashed-fred"]);
    expect(hits.map((h) => h.raw)).toEqual(["EG Sie", "Freddy"]);
  });

  it("prefers an exact shorter token over absorbing leftover unmatched words", () => {
    const hits = consumeGreedyMemberNames("Nova leftover", index);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.match.memberId).toBe("ashed-solo");
    expect(hits[1]?.match.memberId).toBeNull();
    expect(hits[1]?.raw).toBe("leftover");
  });

  it("treats commas as Engineer separators", () => {
    const hits = consumeGreedyMemberNames("EG Sie, Freddy", index);
    expect(hits.map((h) => h.match.memberId)).toEqual(["ashed-eg", "ashed-fred"]);
    expect(hits.map((h) => h.raw)).toEqual(["EG Sie", "Freddy"]);
  });
});

describe("previewPairingImport", () => {
  const commandersByAshedMemberId = new Map([
    ["ashed-wl", { commanderId: "wl-1", profession: "War Leader" as const }],
    ["ashed-eg", { commanderId: "eng-eg", profession: "Engineer" as const }],
    ["ashed-fred", { commanderId: "eng-fred", profession: null }],
    ["ashed-solo", { commanderId: "eng-nova", profession: "Engineer" as const }],
  ]);

  it("marks unset Engineer profession as will_set and ready War Leader", () => {
    const preview = previewPairingImport({
      text: "Bat Pig: EG Sie Freddy",
      members,
      commandersByAshedMemberId,
      activeAssignmentByEngCommanderId: new Map(),
    });
    expect(preview.lines[0]?.wl.status).toBe("ready");
    expect(preview.lines[0]?.engineers.map((e) => e.status)).toEqual([
      "ready",
      "will_set_profession",
    ]);
    expect(preview.readyCount).toBe(2);
  });

  it("does not steal an Engineer already on another War Leader", () => {
    const preview = previewPairingImport({
      text: "Bat Pig: Nova",
      members,
      commandersByAshedMemberId,
      activeAssignmentByEngCommanderId: new Map([["eng-nova", "other-wl"]]),
    });
    expect(preview.lines[0]?.engineers[0]?.status).toBe("other_team");
    expect(preview.readyCount).toBe(0);
  });

  it("treats a second listing of the same Engineer as a paste duplicate", () => {
    const preview = previewPairingImport({
      text: "Bat Pig: Nova\nBat Pig: Nova",
      members,
      commandersByAshedMemberId,
      activeAssignmentByEngCommanderId: new Map(),
    });
    expect(preview.lines[0]?.engineers[0]?.status).toBe("ready");
    expect(preview.lines[1]?.engineers[0]?.status).toBe("duplicate_in_paste");
  });

  it("previews hyphen lines with comma-separated Engineers", () => {
    const preview = previewPairingImport({
      text: "Bat Pig - EG Sie, Freddy",
      members,
      commandersByAshedMemberId,
      activeAssignmentByEngCommanderId: new Map(),
    });
    expect(preview.lines[0]?.wl.status).toBe("ready");
    expect(preview.lines[0]?.engineers.map((e) => e.status)).toEqual([
      "ready",
      "will_set_profession",
    ]);
    expect(preview.readyCount).toBe(2);
  });
});
