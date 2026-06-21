import "server-only";

import { randomBytes } from "crypto";

import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

const ADJECTIVES = [
  "amber",
  "brave",
  "calm",
  "crisp",
  "eager",
  "gentle",
  "lucky",
  "mighty",
  "quiet",
  "rapid",
  "silver",
  "steady",
  "swift",
  "vivid",
  "warm",
] as const;

const NOUNS = [
  "badger",
  "comet",
  "falcon",
  "harbor",
  "meadow",
  "oracle",
  "phoenix",
  "ranger",
  "signal",
  "summit",
  "tiger",
  "valley",
  "voyage",
  "wizard",
  "zenith",
] as const;

function pickWord<T extends readonly string[]>(words: T): string {
  const index = randomBytes(1)[0]! % words.length;
  return words[index]!;
}

export function generateHumanPassphrase(): string {
  const suffix = randomBytes(2).readUInt16BE(0) % 10000;
  return `${pickWord(ADJECTIVES)}-${pickWord(NOUNS)}-${String(suffix).padStart(4, "0")}`;
}

export async function hashPassphrase(passphrase: string): Promise<string> {
  return bcrypt.hash(passphrase.trim(), BCRYPT_ROUNDS);
}

export async function verifyPassphrase(
  passphrase: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(passphrase.trim(), hash);
}
