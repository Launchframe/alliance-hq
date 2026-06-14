import type { ParsedConnection } from "@/lib/connectionString";
import {
  base44ListAlliances,
  type AshedAlliance,
} from "@/lib/base44/fetch";

export type ResolvedAlliance = {
  id: string;
  tag: string;
  name?: string;
};

export function normalizeAllianceTag(tag: string): string {
  return tag.trim();
}

export function findAllianceByTag(
  alliances: AshedAlliance[],
  tag: string,
): AshedAlliance | undefined {
  const needle = normalizeAllianceTag(tag).toLowerCase();
  if (!needle) {
    return undefined;
  }
  return alliances.find((a) => a.tag?.toLowerCase() === needle);
}

export async function resolveAllianceByTag(
  connection: ParsedConnection,
  tag: string,
): Promise<ResolvedAlliance> {
  const normalized = normalizeAllianceTag(tag);
  if (!normalized) {
    throw new Error("Alliance tag is required.");
  }

  const alliances = await base44ListAlliances(connection);
  const match = findAllianceByTag(alliances, normalized);

  if (!match?.id) {
    throw new Error(
      `No alliance found with tag "${normalized}". On ashed.online, open Alliances and confirm your tag (e.g. LFgo).`,
    );
  }

  return {
    id: match.id,
    tag: match.tag ?? normalized,
    name: match.name,
  };
}
