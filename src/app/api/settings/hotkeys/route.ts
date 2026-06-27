import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getHotkeyAction,
} from "@/lib/hotkeys/actions.registry";
import { DEFAULT_HOTKEY_BINDINGS } from "@/lib/hotkeys/defaults";
import {
  loadHotkeyBindings,
  saveHotkeyBindings,
} from "@/lib/hotkeys/hotkey-bindings.server";
import {
  findBindingConflict,
  mergeHotkeyOverride,
  removeHotkeyOverride,
  resolveEffectiveBindings,
} from "@/lib/hotkeys/resolve";
import {
  validateHotkeyBinding,
} from "@/lib/hotkeys/reserved";
import type { HotkeyBinding } from "@/lib/hotkeys/types";
import { getOrCreateSession, readSessionId } from "@/lib/session";

const bindingSchema = z.object({
  modifiers: z
    .array(z.enum(["alt", "shift", "meta", "ctrl"]))
    .optional(),
  key: z.string().min(1).optional(),
  sequence: z.array(z.string().min(1)).min(2).optional(),
});

const patchSchema = z.union([
  z.object({
    actionId: z.string().min(1),
    binding: bindingSchema,
  }),
  z.object({
    reset: z.union([z.literal("all"), z.string().min(1)]),
  }),
]);

export async function GET() {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({
        defaults: DEFAULT_HOTKEY_BINDINGS,
        overrides: {},
        effective: resolveEffectiveBindings({}),
        canEdit: false,
      });
    }

    const session = await getOrCreateSession();
    const payload = await loadHotkeyBindings(session.hqUserId);
    const effective = resolveEffectiveBindings(payload.overrides);

    return NextResponse.json({
      defaults: DEFAULT_HOTKEY_BINDINGS,
      overrides: payload.overrides,
      effective,
      canEdit: Boolean(session.hqUserId),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load hotkey bindings",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = patchSchema.parse(await request.json());
    const session = await getOrCreateSession();

    if (!session.hqUserId) {
      return NextResponse.json(
        { error: "Reconnect to save account preferences." },
        { status: 403 },
      );
    }

    const current = await loadHotkeyBindings(session.hqUserId);

    if ("reset" in body) {
      const nextOverrides =
        body.reset === "all"
          ? {}
          : removeHotkeyOverride(current.overrides, body.reset);

      const saved = await saveHotkeyBindings(session.hqUserId, {
        ...current,
        overrides: nextOverrides,
      });

      return NextResponse.json({
        ok: true,
        overrides: saved.overrides,
        effective: resolveEffectiveBindings(saved.overrides),
      });
    }

    const action = getHotkeyAction(body.actionId);
    if (!action) {
      return NextResponse.json({ error: "Unknown hotkey action." }, { status: 400 });
    }

    const binding = body.binding as HotkeyBinding;
    const validationError = validateHotkeyBinding(binding);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const conflict = findBindingConflict(
      body.actionId,
      binding,
      current.overrides,
    );
    if (conflict) {
      return NextResponse.json(
        {
          error: "That shortcut is already assigned to another action.",
          conflictActionId: conflict,
        },
        { status: 409 },
      );
    }

    const nextOverrides = mergeHotkeyOverride(
      current.overrides,
      body.actionId,
      binding,
    );
    const saved = await saveHotkeyBindings(session.hqUserId, {
      ...current,
      overrides: nextOverrides,
    });

    return NextResponse.json({
      ok: true,
      overrides: saved.overrides,
      effective: resolveEffectiveBindings(saved.overrides),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid hotkey bindings payload." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to save hotkey bindings",
      },
      { status: 500 },
    );
  }
}
