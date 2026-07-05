export type HotkeyModifier = "alt" | "shift" | "meta" | "ctrl";

export type HotkeyBinding = {
  modifiers?: HotkeyModifier[];
  key?: string;
  sequence?: string[];
};

export type HotkeyCategory =
  | "global"
  | "navigation"
  | "admin"
  | "trains"
  | "tools";

export type HotkeyScope = "global" | "page:trains" | "admin-sequence";

export type HotkeyActionKind =
  | "navigate"
  | "open-palette"
  | "open-hotkey-reference"
  | "focus-sidebar"
  | "connect-ashed"
  | "admin-sequence-start"
  | "custom";

export type HotkeyActionDef = {
  id: string;
  labelKey: string;
  category: HotkeyCategory;
  scope: HotkeyScope;
  kind: HotkeyActionKind;
  /** Route for navigate actions */
  href?: string;
  requiredPermission?: string;
  /** Hide when session has this permission (inverse gate for nav parity). */
  hideWhenPermission?: string;
  /** When true, hide unless condition met (e.g. not connected to Ashed) */
  requiresDisconnected?: boolean;
  /** Admin sequence second-step key hint */
  adminSequenceKey?: string;
};

export type HotkeyOverrideEntry = {
  binding: HotkeyBinding;
  updatedAt: string;
};

export type HotkeyBindingsStore = Record<string, HotkeyOverrideEntry>;

export type EffectiveHotkeyBinding = {
  actionId: string;
  binding: HotkeyBinding;
  isOverride: boolean;
  updatedAt: string | null;
};

export const HOTKEY_BINDINGS_SCHEMA_VERSION = 1;

export type HotkeyBindingsPayload = {
  version: typeof HOTKEY_BINDINGS_SCHEMA_VERSION;
  overrides: HotkeyBindingsStore;
};

export type PageHotkeyHandler = () => void | boolean | Promise<void | boolean>;
