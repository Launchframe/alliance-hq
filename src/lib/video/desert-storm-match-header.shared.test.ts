import { describe, expect, it } from "vitest";

import {
  blankDesertStormMatchHeader,
  buildDesertStormMatchAshedPatch,
  compareDesertStormRowSumToTeamTotal,
  desertStormMatchHasOfficerInput,
  parseDesertStormMatchHeaderLines,
  parseDesertStormMatchSubmitFields,
  readDesertStormMatchFromRawExtract,
} from "./desert-storm-match-header.shared";

const US = {
  gameServerNumber: 1203,
  name: "Live Free Die Hard",
};

describe("parseDesertStormMatchHeaderLines", () => {
  it("prefills opponent + loss from two card lines (mail header)", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "[Desert Storm] Battle Results!",
        "#1203 Live Free Die Hard 253,498",
        "#1229 Keep Partner On Path 325,382",
        "Battle Status",
        "Highest Total Score Zudie dwdx 7,149,057",
        "[LFgo]Zudie dwdx 7,149,057",
      ],
      US,
    );
    expect(parsed.filledFromOcr).toBe(true);
    expect(parsed.outcome).toBe("loss");
    expect(parsed.opponentServer).toBe("1229");
    expect(parsed.opponentName).toBe("Keep Partner On Path");
    expect(parsed.opponentTag).toBe("");
    expect(parsed.oursTotal).toBe(253498);
    expect(parsed.theirsTotal).toBe(325382);
  });

  it("prefills win when our card total is higher", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1229 Keep Partner On Path 200,000",
        "#1203 Live Free Die Hard 400,000",
      ],
      US,
    );
    expect(parsed.outcome).toBe("win");
    expect(parsed.opponentServer).toBe("1229");
    expect(parsed.opponentName).toBe("Keep Partner On Path");
  });

  it("stays pending on equal totals but still fills opponent", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1203 Live Free Die Hard 250,000",
        "#1229 Keep Partner On Path 250,000",
      ],
      US,
    );
    expect(parsed.filledFromOcr).toBe(true);
    expect(parsed.outcome).toBe("pending");
    expect(parsed.opponentServer).toBe("1229");
    expect(parsed.opponentName).toBe("Keep Partner On Path");
  });

  it("identifies us by name when server OCR is only on the opponent card", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#9999 Keep Partner On Path 100,000",
        "#8888 Live Free Die Hard 200,000",
      ],
      { gameServerNumber: 1203, name: "Live Free Die Hard" },
    );
    expect(parsed.outcome).toBe("win");
    expect(parsed.opponentServer).toBe("9999");
  });

  it("zips column-layout header using our alliance name", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1203 #1229",
        "Live Free Die Hard Keep Partner On Path",
        "253,498 325,382",
        "Battle Status",
      ],
      US,
    );
    expect(parsed.filledFromOcr).toBe(true);
    expect(parsed.outcome).toBe("loss");
    expect(parsed.opponentServer).toBe("1229");
    expect(parsed.opponentName).toBe("Keep Partner On Path");
  });

  it("zips column-layout names when OCR punctuation differs from the stored alliance name", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1203 #1229",
        "Live-Free Die Hard Keep Partner On Path",
        "253,498 325,382",
      ],
      US,
    );
    expect(parsed.filledFromOcr).toBe(true);
    expect(parsed.opponentServer).toBe("1229");
    expect(parsed.opponentName).toBe("Keep Partner On Path");
  });

  it("parses stacked per-card blocks", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      ["#1203", "Live Free Die Hard", "253,498", "#1229", "Keep Partner On Path", "325,382"],
      US,
    );
    expect(parsed.filledFromOcr).toBe(true);
    expect(parsed.opponentServer).toBe("1229");
    expect(parsed.outcome).toBe("loss");
  });

  it("junks all prefill when the first frame is the individual leaderboard", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "Individual Points",
        "[LFgo]Zudie dwdx 7,149,057",
        "[LFgo]NobuU DwDx 6,759,854",
      ],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });

  it("junks all prefill when the officer skipped the outcome header", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "[Desert Storm] Battle Results!",
        "Individual Points",
        "[LFgo]Zudie dwdx 7,149,057",
      ],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });

  it("junks all prefill when only one alliance card is complete", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1203 Live Free Die Hard 253,498",
        "Battle Status",
        "Individual Points",
      ],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });

  it("junks opponent when scores cannot be compared", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1203 Live Free Die Hard 253,498",
        "#1229 Keep Partner On Path",
      ],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });

  it("junks all prefill when scores are missing", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      ["#1203 Live Free Die Hard", "#1229 Keep Partner On Path"],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });

  it("junks all prefill when neither side is us", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1111 Alpha Alliance 100,000",
        "#2222 Beta Alliance 200,000",
      ],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });

  it("junks all prefill when both cards share our server number", () => {
    const parsed = parseDesertStormMatchHeaderLines(
      [
        "#1203 Live Free Die Hard 100,000",
        "#1203 Keep Partner On Path 200,000",
      ],
      US,
    );
    expect(parsed).toEqual(blankDesertStormMatchHeader());
  });
});

describe("buildDesertStormMatchAshedPatch", () => {
  it("maps team A fields for Ashed DesertStormEvent.update", () => {
    expect(
      buildDesertStormMatchAshedPatch("A", {
        outcome: "win",
        opponentServer: "1229",
        opponentTag: "KPOP",
        opponentName: "Keep Partner On Path",
        oursTotal: 1,
        theirsTotal: 2,
        filledFromOcr: true,
      }),
    ).toEqual({
      team_a_result: "win",
      team_a_opponent_server: 1229,
      team_a_opponent_tag: "KPOP",
      team_a_opponent_name: "Keep Partner On Path",
    });
  });

  it("maps team B and nulls empty opponent fields", () => {
    expect(
      buildDesertStormMatchAshedPatch("B", blankDesertStormMatchHeader()),
    ).toEqual({
      team_b_result: "pending",
      team_b_opponent_server: null,
      team_b_opponent_tag: null,
      team_b_opponent_name: null,
    });
  });
});

describe("desertStormMatchHasOfficerInput", () => {
  it("is false for blank pending", () => {
    expect(desertStormMatchHasOfficerInput(blankDesertStormMatchHeader())).toBe(
      false,
    );
  });

  it("is true when outcome or opponent is set", () => {
    expect(
      desertStormMatchHasOfficerInput({
        ...blankDesertStormMatchHeader(),
        outcome: "loss",
      }),
    ).toBe(true);
    expect(
      desertStormMatchHasOfficerInput({
        ...blankDesertStormMatchHeader(),
        opponentServer: "1229",
      }),
    ).toBe(true);
  });
});

describe("readDesertStormMatchFromRawExtract", () => {
  it("reads a stored header and blanks junk", () => {
    const header = parseDesertStormMatchHeaderLines(
      ["#1203 Live Free Die Hard 100,000", "#1229 Keep Partner On Path 50,000"],
      US,
    );
    expect(
      readDesertStormMatchFromRawExtract({ desertStormMatch: header }),
    ).toEqual(header);
    expect(readDesertStormMatchFromRawExtract(null)).toEqual(
      blankDesertStormMatchHeader(),
    );
    expect(
      readDesertStormMatchFromRawExtract({ desertStormMatch: { outcome: "win" } }),
    ).toEqual(blankDesertStormMatchHeader());
  });
});

describe("compareDesertStormRowSumToTeamTotal", () => {
  it("skips the check when the home-team total is not populated", () => {
    expect(
      compareDesertStormRowSumToTeamTotal({
        teamTotal: null,
        scores: ["100", "200"],
      }),
    ).toBeNull();
    expect(
      compareDesertStormRowSumToTeamTotal({
        teamTotal: 0,
        scores: ["100"],
      }),
    ).toBeNull();
  });

  it("reports missing rows when the leaderboard sum is short", () => {
    expect(
      compareDesertStormRowSumToTeamTotal({
        teamTotal: 253_498,
        scores: ["100,000", "50,000"],
      }),
    ).toEqual({
      status: "short",
      rowSum: 150_000,
      teamTotal: 253_498,
      delta: 103_498,
    });
  });

  it("reports extra scores when the leaderboard sum exceeds the team total", () => {
    expect(
      compareDesertStormRowSumToTeamTotal({
        teamTotal: 250_000,
        scores: ["200000", "60000"],
      }),
    ).toEqual({
      status: "over",
      rowSum: 260_000,
      teamTotal: 250_000,
      delta: 10_000,
    });
  });

  it("treats an exact match as ok", () => {
    expect(
      compareDesertStormRowSumToTeamTotal({
        teamTotal: 300_000,
        scores: ["100,000", "200000"],
      }),
    ).toMatchObject({ status: "ok", rowSum: 300_000, delta: 0 });
  });

  it("ignores unparseable row scores", () => {
    expect(
      compareDesertStormRowSumToTeamTotal({
        teamTotal: 100,
        scores: ["100", "", "nope", null],
      }),
    ).toMatchObject({ status: "ok", rowSum: 100 });
  });
});

describe("parseDesertStormMatchSubmitFields", () => {
  it("defaults invalid outcome to pending", () => {
    expect(
      parseDesertStormMatchSubmitFields({
        matchOutcome: "draw",
        opponentServer: "1229",
        opponentTag: "AB",
        opponentName: "Them",
      }),
    ).toMatchObject({
      outcome: "pending",
      opponentServer: "1229",
      opponentTag: "AB",
      opponentName: "Them",
      filledFromOcr: false,
    });
  });
});
