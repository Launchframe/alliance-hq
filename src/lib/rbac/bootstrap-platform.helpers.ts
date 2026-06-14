import { normalizeAshedEmail } from "@/lib/alliance/accessible";

export function isBootstrapEmailMatch(
  userEmail: string,
  bootstrapEmail: string | undefined,
): boolean {
  const configured = bootstrapEmail?.trim();
  if (!configured) {
    return false;
  }
  return normalizeAshedEmail(userEmail) === normalizeAshedEmail(configured);
}
