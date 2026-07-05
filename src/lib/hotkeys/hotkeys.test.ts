import { describe, expect, it } from "vitest";

import {
  advanceSequenceState,
  chordMatchesEvent,
  createSequenceState,
  findMatchingActionId,
  parseKeyboardEvent,
  sequenceMatchesBinding,
} from "@/lib/hotkeys/engine";
import {
  assertHotkeyRegistryIntegrity,
  checkHotkeyRegistryIntegrity,
  sanitizeHotkeyOverrides,
} from "@/lib/hotkeys/registry-integrity.shared";
import { TRAINS_HOTKEY_ACTION_IDS } from "@/lib/hotkeys/trains-hotkeys.shared";
import { safeRunHotkeyHandler } from "@/lib/hotkeys/safe-execute.shared";
import {
  HOTKEY_ACTIONS,
  getHotkeyAction,
  isHotkeyActionAllowed,
} from "@/lib/hotkeys/actions.registry";
import {
  findBindingConflict,
  resolveEffectiveBinding,
  resolveEffectiveBindings,
} from "@/lib/hotkeys/resolve";
import type { HotkeyBinding } from "@/lib/hotkeys/types";
import {
  bindingSignature,
  isReservedBinding,
  validateHotkeyBinding,
} from "@/lib/hotkeys/reserved";

describe("hotkey reserved bindings", () => {
  it("blocks browser-owned chords", () => {
    expect(
      isReservedBinding({ modifiers: ["meta"], key: "t" }),
    ).toBe(true);
    expect(validateHotkeyBinding({ modifiers: ["meta"], key: "k" })).toBeNull();
  });

  it("creates stable binding signatures", () => {
    expect(
      bindingSignature({ sequence: ["g", "m"] }),
    ).toBe("seq:g>m");
    expect(
      bindingSignature({ modifiers: ["meta", "shift"], key: "k" }),
    ).toBe("chord:meta+shift:k");
  });
});

describe("hotkey engine", () => {
  it("matches chords and sequences", () => {
    const event = parseKeyboardEvent({
      key: "k",
      altKey: false,
      shiftKey: false,
      metaKey: true,
      ctrlKey: false,
    } as KeyboardEvent);

    expect(
      chordMatchesEvent({ modifiers: ["meta"], key: "k" }, event),
    ).toBe(true);

    const sequenceBinding = { sequence: ["g", "m"] };
    expect(sequenceMatchesBinding(sequenceBinding, ["g"])).toBe(false);
    expect(sequenceMatchesBinding(sequenceBinding, ["g", "m"])).toBe(true);
  });

  it("treats meta and ctrl as the same primary modifier (cross-platform Mod)", () => {
    const ctrlEvent = parseKeyboardEvent({
      key: "k",
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ctrlKey: true,
    } as KeyboardEvent);

    // Default palette binding is meta+k; a Ctrl+K press (Windows/Linux) must match.
    expect(chordMatchesEvent({ modifiers: ["meta"], key: "k" }, ctrlEvent)).toBe(
      true,
    );

    // Shift must still differ — only meta/ctrl are unified.
    expect(
      chordMatchesEvent({ modifiers: ["meta", "shift"], key: "k" }, ctrlEvent),
    ).toBe(false);
  });

  it("finds matching actions for chords and completed sequences", () => {
    const bindings: Array<{ actionId: string; binding: HotkeyBinding }> = [
      {
        actionId: "global.openPalette",
        binding: { modifiers: ["meta"], key: "k" },
      },
      { actionId: "nav.members", binding: { sequence: ["g", "m"] } },
    ];

    const chordEvent = parseKeyboardEvent({
      key: "k",
      altKey: false,
      shiftKey: false,
      metaKey: true,
      ctrlKey: false,
    } as KeyboardEvent);

    expect(findMatchingActionId(bindings, chordEvent, [])).toBe(
      "global.openPalette",
    );

    const sequenceState = advanceSequenceState(
      createSequenceState(),
      parseKeyboardEvent({
        key: "g",
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent),
      1_000,
    );
    const completed = advanceSequenceState(
      sequenceState,
      parseKeyboardEvent({
        key: "m",
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent),
      1_100,
    );

    expect(
      findMatchingActionId(bindings, parseKeyboardEvent({
        key: "m",
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
      } as KeyboardEvent), completed.keys),
    ).toBe("nav.members");
  });
});

describe("hotkey resolve", () => {
  it("merges defaults with overrides", () => {
    const effective = resolveEffectiveBinding("nav.members", {
      "nav.members": {
        binding: { modifiers: ["meta"], key: "m" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(effective?.binding).toEqual({ modifiers: ["meta"], key: "m" });
    expect(effective?.isOverride).toBe(true);
  });

  it("detects binding conflicts", () => {
    const overrides = {
      "nav.members": {
        binding: { modifiers: ["meta"], key: "m" } satisfies HotkeyBinding,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    expect(
      findBindingConflict(
        "nav.trains",
        { modifiers: ["meta"], key: "m" },
        overrides,
      ),
    ).toBe("nav.members");
  });

  it("includes defaults in effective bindings", () => {
    const bindings = resolveEffectiveBindings({});
    expect(bindings.some((entry) => entry.actionId === "global.openPalette")).toBe(
      true,
    );
  });

  it("drops orphan override keys from removed actions", () => {
    const bindings = resolveEffectiveBindings({
      "removed.action": {
        binding: { key: "x" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(bindings.some((entry) => entry.actionId === "removed.action")).toBe(
      false,
    );
  });
});

describe("hotkey registry integrity", () => {
  it("keeps registry actions and defaults in sync", () => {
    expect(() => assertHotkeyRegistryIntegrity()).not.toThrow();
    expect(checkHotkeyRegistryIntegrity()).toEqual({
      missingDefaults: [],
      orphanDefaults: [],
    });
  });

  it("keeps trains handler ids aligned with registry", () => {
    const registryTrainIds = HOTKEY_ACTIONS.filter(
      (action) => action.scope === "page:trains",
    )
      .map((action) => action.id)
      .sort();

    expect([...TRAINS_HOTKEY_ACTION_IDS].sort()).toEqual(registryTrainIds);
  });

  it("mirrors VR nav gates for officers vs members", () => {
    const myVr = getHotkeyAction("nav.myVr");
    const viralResistance = getHotkeyAction("nav.viralResistance");
    expect(myVr).toBeDefined();
    expect(viralResistance).toBeDefined();

    const officerPerms = new Set(["members:write"]);
    expect(isHotkeyActionAllowed(myVr!, officerPerms)).toBe(false);
    expect(isHotkeyActionAllowed(viralResistance!, officerPerms)).toBe(true);

    const memberPerms = new Set<string>();
    expect(isHotkeyActionAllowed(myVr!, memberPerms)).toBe(true);
    expect(isHotkeyActionAllowed(viralResistance!, memberPerms)).toBe(false);
  });
});

describe("hotkey safe execution", () => {
  it("swallows handler errors", async () => {
    await expect(
      safeRunHotkeyHandler("trains.spinWheel", () => {
        throw new Error("boom");
      }),
    ).resolves.toBeUndefined();
  });

  it("no-ops when handler is missing", async () => {
    await expect(
      safeRunHotkeyHandler("trains.spinWheel", undefined),
    ).resolves.toBeUndefined();
  });

  it("sanitizes stale override keys", () => {
    expect(
      sanitizeHotkeyOverrides({
        "nav.members": {
          binding: { key: "m" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        "legacy.removed": {
          binding: { key: "x" },
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toEqual({
      "nav.members": {
        binding: { key: "m" },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });
});
