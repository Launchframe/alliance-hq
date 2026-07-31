import { randomBytes } from "node:crypto";

const ADJECTIVES = [
  "brittle",
  "calm",
  "clever",
  "dapper",
  "eager",
  "gentle",
  "humble",
  "jolly",
  "lucky",
  "mellow",
  "nimble",
  "plucky",
  "quiet",
  "rapid",
  "steady",
  "swift",
  "witty",
] as const;

const NOUNS = [
  "badger",
  "biscuit",
  "comet",
  "falcon",
  "harbor",
  "meadow",
  "otter",
  "pigeon",
  "rocket",
  "sparrow",
  "summit",
  "thistle",
  "valley",
  "willow",
] as const;

function pickWord<T extends readonly string[]>(words: T): T[number] {
  const index = randomBytes(1)[0]! % words.length;
  return words[index]!;
}

/** Human-friendly video job id: adjective-noun-hex (e.g. brittle-biscuit-a1b2c3d4). */
export function newReadableVideoJobId(): string {
  const suffix = randomBytes(4).toString("hex");
  return `${pickWord(ADJECTIVES)}-${pickWord(NOUNS)}-${suffix}`;
}
