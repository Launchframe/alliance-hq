import { describe, expect, it, vi } from "vitest";

import { createFollowAnchorRegistry } from "@/lib/video/follow-me-anchor-registry";

type FakeEl = { id: string };

describe("createFollowAnchorRegistry", () => {
  it("returns a stable callback ref per row id across renders", () => {
    const registry = createFollowAnchorRegistry<FakeEl>({ onChange: () => {} });

    // Simulate the per-row ref factory being called on multiple renders.
    const first = registry.register("row-1");
    const second = registry.register("row-1");
    const other = registry.register("row-2");

    expect(second).toBe(first);
    expect(other).not.toBe(first);
  });

  it("does not notify when React re-attaches the same element (no render loop)", () => {
    const onChange = vi.fn();
    const registry = createFollowAnchorRegistry<FakeEl>({ onChange });
    const ref = registry.register("row-1");
    const el: FakeEl = { id: "el-1" };

    // Initial mount.
    ref(el);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(registry.elements.get("row-1")).toBe(el);

    // React's detach/reattach of the *same* element with a stable callback must
    // be a no-op for onChange — otherwise we'd loop (React error #185).
    ref(el);
    ref(el);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("notifies once on mount and once on unmount", () => {
    const onChange = vi.fn();
    const registry = createFollowAnchorRegistry<FakeEl>({ onChange });
    const ref = registry.register("row-1");
    const el: FakeEl = { id: "el-1" };

    ref(el);
    ref(null);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(registry.elements.has("row-1")).toBe(false);

    // Detaching when nothing is mounted must not notify.
    ref(null);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("notifies when an anchor swaps to a different element node", () => {
    const onChange = vi.fn();
    const registry = createFollowAnchorRegistry<FakeEl>({ onChange });
    const ref = registry.register("row-1");
    const first: FakeEl = { id: "el-1" };
    const second: FakeEl = { id: "el-2" };

    ref(first);
    ref(second);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(registry.elements.get("row-1")).toBe(second);
  });
});
