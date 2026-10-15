/**
 * Live OCR worker/media lease: running + matching token + unexpired lease and job TTL.
 * Complete/heartbeat already enforce this; fail paths must too so expired leases
 * remain reclaimable instead of terminalizing with attempts left.
 */
export function isLiveOcrLease(
  job: {
    state: string;
    leaseToken: string | null;
    leaseExpiresAt: Date | null;
    expiresAt: Date;
  },
  token: string,
  now: Date = new Date(),
): boolean {
  return (
    job.state === "running" &&
    job.leaseToken === token &&
    job.leaseExpiresAt != null &&
    job.leaseExpiresAt.getTime() > now.getTime() &&
    job.expiresAt.getTime() > now.getTime()
  );
}
