import { get } from "@vercel/edge-config";

import { validateReleaseNoteEntries } from "./validate";
import { HQ_RELEASE_NOTES_EDGE_CONFIG_KEY } from "./types";
import type { ReleaseNoteEntry } from "./types";

export async function loadReleaseNotesFromEdgeConfig(): Promise<
  ReleaseNoteEntry[]
> {
  try {
    const value = await get(HQ_RELEASE_NOTES_EDGE_CONFIG_KEY);
    return validateReleaseNoteEntries(value);
  } catch {
    return [];
  }
}
