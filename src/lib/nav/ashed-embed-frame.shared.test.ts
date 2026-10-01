import { describe, expect, it } from "vitest";

import {
  ASHED_EMBED_FRAME_CLASS,
  ASHED_EMBED_FRAME_WITH_PAGE_CHROME_CLASS,
} from "@/lib/nav/ashed-embed-frame.shared";

describe("ashed-embed-frame.shared", () => {
  it("sizes the default frame from the dynamic viewport, not a 720px cap", () => {
    expect(ASHED_EMBED_FRAME_CLASS).toContain("100dvh");
    expect(ASHED_EMBED_FRAME_CLASS).not.toContain("70vh");
    expect(ASHED_EMBED_FRAME_CLASS).not.toContain("720px");
  });

  it("gives embed pages with HQ chrome a taller desktop subtract", () => {
    expect(ASHED_EMBED_FRAME_WITH_PAGE_CHROME_CLASS).toContain("md:h-[");
    expect(ASHED_EMBED_FRAME_WITH_PAGE_CHROME_CLASS).toContain("16rem");
    expect(ASHED_EMBED_FRAME_WITH_PAGE_CHROME_CLASS).not.toContain("720px");
  });
});
