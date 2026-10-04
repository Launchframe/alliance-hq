import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./access.server", () => ({ requireNotesApiContext: vi.fn(), notesErrorResponse: vi.fn() }));
const { readKnowledgeJson } = await import("./knowledge-api.server");

it("accepts small JSON requests without changing their values", async () => {
  const request = new Request("http://localhost/api/notes/knowledge/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: "A private question" }) });
  await expect(readKnowledgeJson(request)).resolves.toEqual({ q: "A private question" });
});
it("bounds actual streamed bytes even when the declared size is smaller", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(8193))); }, cancel: cancelled });
  const init: RequestInit & { duplex: "half" } = { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1" }, body, duplex: "half" };
  await expect(readKnowledgeJson(new Request("http://localhost/api/notes/knowledge/search", init))).rejects.toMatchObject({ code: "invalid" });
  expect(cancelled).toHaveBeenCalledOnce();
});
it("rejects malformed JSON and non-JSON bodies", async () => {
  await expect(readKnowledgeJson(new Request("http://localhost/api", { method: "POST", body: "x" }))).rejects.toMatchObject({ code: "invalid" });
  await expect(readKnowledgeJson(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).rejects.toMatchObject({ code: "invalid" });
});
