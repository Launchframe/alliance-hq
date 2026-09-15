import { expect, it } from "vitest";
import { publicSnapshotText, sensitiveNotesPath } from "./publications.shared";

it("removes links, embeds, private references and binding data from the actual snapshot", () => {
  const value = publicSnapshotText(`# Plan\n[Private](/notes/hidden-id) ![scan](https://example.test/pixel)\nsource:private-id [1]\ntoken=synthetic-secret ${"1".repeat(14)}`);
  expect(value).toContain("Plan");
  for (const forbidden of ["/notes/", "example.test", "source:private-id", "[1]", "synthetic-secret", "1".repeat(14)]) expect(value).not.toContain(forbidden);
});
it("treats localized Notes and capability URLs as sensitive, without disabling unrelated pages", () => {
  expect(sensitiveNotesPath("/pt-BR/notes?view=studio")).toBe(true);
  expect(sensitiveNotesPath("/en-US/shared/notes/capability")).toBe(true);
  expect(sensitiveNotesPath("/Shared/%6eotes/capability")).toBe(true);
  expect(sensitiveNotesPath("/trains")).toBe(false);
});
