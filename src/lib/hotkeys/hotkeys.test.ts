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
});
