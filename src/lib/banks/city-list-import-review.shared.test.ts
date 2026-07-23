import { describe, expect, it } from "vitest";

import {
  cityListImportBankIdentityError,
  cityListReviewRowsHaveErrors,
  classifyCityListImportRowsAgainstHq,
  clampReviewIndexAfterRemove,
  defaultPlaceholderGameServerNumber,
  isCityListPlaceholderCoords,
  missingRowCountForCapturedCount,
  validateCityListReviewRow,
} from "@/lib/banks/city-list-import-review.shared";

describe("clampReviewIndexAfterRemove", () => {
  it("returns 0 when all rows are removed", () => {
    expect(clampReviewIndexAfterRemove(2, 1, 0)).toBe(0);
  });

  it("decrements index when a row before the current one is removed", () => {
    expect(clampReviewIndexAfterRemove(3, 1, 4)).toBe(2);
  });

  it("keeps index when the current row is removed and a successor exists", () => {
    expect(clampReviewIndexAfterRemove(2, 2, 4)).toBe(2);
  });

  it("clamps to the last row when the final row is removed", () => {
    expect(clampReviewIndexAfterRemove(4, 4, 4)).toBe(3);
  });
});

describe("isCityListPlaceholderCoords", () => {
  it("is true only for the (0, 0) sentinel", () => {
    expect(isCityListPlaceholderCoords(0, 0)).toBe(true);
    expect(isCityListPlaceholderCoords(0, 499)).toBe(false);
    expect(isCityListPlaceholderCoords(599, 0)).toBe(false);
    expect(isCityListPlaceholderCoords(599, 499)).toBe(false);
  });
});

describe("missingRowCountForCapturedCount", () => {
  it("returns 0 when captured count is unavailable", () => {
    expect(missingRowCountForCapturedCount(5, null)).toBe(0);
  });

  it("returns 0 when captured count is non-positive", () => {
    expect(missingRowCountForCapturedCount(5, 0)).toBe(0);
    expect(missingRowCountForCapturedCount(0, 0)).toBe(0);
    expect(missingRowCountForCapturedCount(2, -1)).toBe(0);
  });

  it("returns 0 when parsed rows already meet or exceed the captured count", () => {
    expect(missingRowCountForCapturedCount(6, 6)).toBe(0);
    expect(missingRowCountForCapturedCount(7, 6)).toBe(0);
  });

  it("returns the gap when OCR parsed fewer tiles than the captured count", () => {
    expect(missingRowCountForCapturedCount(5, 7)).toBe(2);
    expect(missingRowCountForCapturedCount(0, 3)).toBe(3);
  });

  it("clamps the pad target to capturedLimit when N exceeds M", () => {
    expect(missingRowCountForCapturedCount(2, 33, 6)).toBe(4);
    expect(missingRowCountForCapturedCount(6, 33, 6)).toBe(0);
  });

  it("ignores a non-positive capturedLimit and pads to capturedCount", () => {
    expect(missingRowCountForCapturedCount(2, 5, 0)).toBe(3);
    expect(missingRowCountForCapturedCount(2, 5, null)).toBe(3);
  });
});

describe("defaultPlaceholderGameServerNumber", () => {
  it("prefers an existing review row's server number", () => {
    expect(defaultPlaceholderGameServerNumber([1211, 1211], [999])).toBe(
      1211,
    );
  });

  it("falls back to an existing HQ bank's server number", () => {
    expect(defaultPlaceholderGameServerNumber([], [999])).toBe(999);
  });

  it("falls back to 0 when neither source has a positive server number", () => {
    expect(defaultPlaceholderGameServerNumber([0], [])).toBe(0);
  });
});

describe("validateCityListReviewRow", () => {
  it("returns no errors for a fully filled-in row", () => {
    expect(
      validateCityListReviewRow(
        { level: 3, gameServerNumber: 1211, coordX: 599, coordY: 499 },
        "Required",
        "Level must be at least 1",
      ),
    ).toEqual({});
  });

  it("flags level below 1", () => {
    const errors = validateCityListReviewRow(
      { level: 0, gameServerNumber: 1211, coordX: 599, coordY: 499 },
      "Required",
      "Level must be at least 1",
    );
    expect(errors.level).toBe("Level must be at least 1");
  });

  it("flags a missing game server number", () => {
    const errors = validateCityListReviewRow(
      { level: 3, gameServerNumber: 0, coordX: 599, coordY: 499 },
      "Required",
      "Level must be at least 1",
    );
    expect(errors.gameServerNumber).toBe("Required");
  });

  it("flags placeholder (0, 0) coordinates as unfilled", () => {
    const errors = validateCityListReviewRow(
      { level: 1, gameServerNumber: 1211, coordX: 0, coordY: 0 },
      "Required",
      "Level must be at least 1",
    );
    expect(errors.coordX).toBe("Required");
    expect(errors.coordY).toBe("Required");
  });

  it("does not flag a real coordinate on one axis at the origin", () => {
    const errors = validateCityListReviewRow(
      { level: 1, gameServerNumber: 1211, coordX: 0, coordY: 499 },
      "Required",
      "Level must be at least 1",
    );
    expect(errors.coordX).toBeUndefined();
    expect(errors.coordY).toBeUndefined();
  });
});

describe("cityListImportBankIdentityError", () => {
  it("returns null for a valid identity", () => {
    expect(cityListImportBankIdentityError(1211, 599, 499)).toBeNull();
    expect(cityListImportBankIdentityError(1211, 0, 499)).toBeNull();
  });

  it("rejects a non-positive game server number", () => {
    expect(cityListImportBankIdentityError(0, 599, 499)).toMatch(
      /positive gameServerNumber/i,
    );
  });

  it("rejects placeholder (0, 0) coordinates", () => {
    expect(cityListImportBankIdentityError(1211, 0, 0)).toMatch(
      /\(0, 0\)/i,
    );
  });
});

describe("cityListReviewRowsHaveErrors", () => {
  it("returns false when every row is valid", () => {
    expect(
      cityListReviewRowsHaveErrors(
        [{ level: 3, gameServerNumber: 1211, coordX: 599, coordY: 499 }],
        "Required",
        "Level must be at least 1",
      ),
    ).toBe(false);
  });

  it("returns true when any row has a placeholder (0, 0) coordinate", () => {
    expect(
      cityListReviewRowsHaveErrors(
        [
          { level: 3, gameServerNumber: 1211, coordX: 599, coordY: 499 },
          { level: 1, gameServerNumber: 1211, coordX: 0, coordY: 0 },
        ],
        "Required",
        "Level must be at least 1",
      ),
    ).toBe(true);
  });
});

describe("classifyCityListImportRowsAgainstHq", () => {
  it("counts existing vs new by exact server+X+Y", () => {
    const result = classifyCityListImportRowsAgainstHq(
      [
        { gameServerNumber: 1203, coordX: 199, coordY: 599 },
        { gameServerNumber: 1203, coordX: 300, coordY: 400 },
        { gameServerNumber: 1203, coordX: 0, coordY: 0 },
      ],
      [{ gameServerNumber: 1203, coordX: 199, coordY: 599 }],
    );
    expect(result.existingCount).toBe(1);
    expect(result.newCount).toBe(1);
    expect(
      result.rowExistsInHq({
        gameServerNumber: 1203,
        coordX: 199,
        coordY: 599,
      }),
    ).toBe(true);
    expect(
      result.rowExistsInHq({
        gameServerNumber: 1203,
        coordX: 300,
        coordY: 400,
      }),
    ).toBe(false);
  });
});
