export type BagGridLayout = {
  cols: number;
  rows: number;
  padLeft: number;
  padTop: number;
  cellW: number;
  cellH: number;
};

export type BagCellBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type BagParseMatchedRow = {
  cellIndex: number;
  slug: string;
  displayName: string;
  quantity: number;
  confidence: number;
};

export type BagParseUnknownRow = {
  cellIndex: number;
  quantity: number | null;
};

export type BagParseResult = {
  matched: BagParseMatchedRow[];
  unknown: BagParseUnknownRow[];
  grid: { cols: number; rows: number };
  durationMs: number;
};
