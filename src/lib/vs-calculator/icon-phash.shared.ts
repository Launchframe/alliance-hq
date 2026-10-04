/** dHash hamming distance between two 16-char hex fingerprints (64 bits). */
export function hammingDistanceHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) {
    return 64;
  }
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    dist += popcount4(xor);
  }
  return dist;
}

function popcount4(n: number): number {
  return ((n >> 3) & 1) + ((n >> 2) & 1) + ((n >> 1) & 1) + (n & 1);
}

/** Max hamming distance to accept an icon template match (64-bit dHash). */
export const ICON_PHASH_MATCH_THRESHOLD = 12;
