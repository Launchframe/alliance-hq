import { expect, it } from "vitest";
import { noteSearchSchema } from "./search.shared";

it("bounds search input and pagination without granting scope from the payload", () => {
  expect(noteSearchSchema.parse({ q: " Strategy ", allianceId: "untrusted", limit: "10" })).toEqual({ q: "Strategy", kind: "all", offset: 0, limit: 10 });
  expect(noteSearchSchema.safeParse({ q: " " }).success).toBe(false);
  expect(noteSearchSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  expect(noteSearchSchema.safeParse({ q: "test", limit: 26 }).success).toBe(false);
  expect(noteSearchSchema.safeParse({ q: "test", offset: -1 }).success).toBe(false);
  expect(noteSearchSchema.safeParse({ q: "test", kind: "alliance" }).success).toBe(false);
});
