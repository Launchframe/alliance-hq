import { createServer, type Server } from "node:http";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { nanoid } from "nanoid";
import { createNotesFixture } from "./fixtures/notes";
import { authCookieHeader, getE2eSql } from "./fixtures/db";
import { discordTestFollowupPort, signedDiscordTestPayload } from "./fixtures/discord-signing";

type Reply = { content: string; components: Array<{ components: Array<{ custom_id: string; label?: string; value?: string }> }> };
const replies = new Map<string, Reply>();
let server: Server;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => { replies.set(req.url!.split("/")[5], JSON.parse(body)); res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  });
  await new Promise<void>((resolve) => server.listen(discordTestFollowupPort(), "127.0.0.1", resolve));
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });

async function fixture(linked = true) {
  const value = await createNotesFixture("officer");
  const sql = getE2eSql();
  const guild = nanoid(); const authorDiscord = nanoid(); const peerDiscord = nanoid();
  await sql`INSERT INTO discord_guild_alliances (guild_id, alliance_id) VALUES (${guild}, ${value.alliance.allianceId})`;
  for (const [person, discord] of [[value.author, authorDiscord], [value.peer, peerDiscord]] as const) {
    await sql`INSERT INTO discord_member_links (id, alliance_id, discord_user_id, ashed_member_id, member_display_name, game_uid)
      SELECT ${nanoid()}, alliance_id, ${discord}, ashed_member_id, member_display_name, game_uid FROM hq_member_links WHERE hq_user_id = ${person.hqUserId} AND alliance_id = ${value.alliance.allianceId}`;
    if (linked) await sql`INSERT INTO discord_hq_links (discord_user_id, hq_user_id, linked_at) VALUES (${discord}, ${person.hqUserId}, now())`;
  }
  return { ...value, guild, authorDiscord, peerDiscord };
}
function control(reply: Reply, action: string) {
  const found = reply.components.flatMap((row) => row.components).find((component) => component.custom_id.split(":")[4] === action);
  if (!found) throw new Error(`Missing ${action} control`);
  return found.custom_id;
}
async function send(request: APIRequestContext, f: Awaited<ReturnType<typeof fixture>>, type: number, data: Record<string, unknown>, user = f.authorDiscord) {
  const token = nanoid();
  const payload = { id: nanoid(), application_id: "notes-test", token, type, guild_id: f.guild, locale: "en-US", member: { user: { id: user } }, data };
  const response = await request.post("/api/webhooks/discord/interactions", signedDiscordTestPayload(payload));
  expect(response.status()).toBe(200);
  const ack = await response.json();
  if (ack.type === 9) return { ack, reply: null as Reply | null };
  expect(ack).toMatchObject(type === 2 ? { type: 5, data: { flags: 64 } } : { type: 6 });
  await expect.poll(() => replies.has(token), { timeout: 15_000 }).toBe(true);
  return { ack, reply: replies.get(token)! as Reply | null };
}

test("signed Discord capture reviews members and work, retains manual None, and commits once", async ({ request }) => {
  const f = await fixture();
  const sql = getE2eSql();
  let reply = (await send(request, f, 2, { name: "note", options: [{ name: "text", type: 3, value: "Cookie and Ferg are already sorting out train coverage. This is urgent." }] })).reply!;
  expect(reply.content).toContain("Cookie, Ferg");
  const [before] = await sql`SELECT count(*)::int AS count FROM performance_notes WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(before.count).toBe(0);
  const denied = (await send(request, f, 3, { custom_id: control(reply, "save") }, f.peerDiscord)).reply!;
  expect(denied.content).toContain("unavailable");
  reply = (await send(request, f, 3, { custom_id: control(reply, "ai") })).reply!;
  expect(reply.content).toContain("In progress");
  reply = (await send(request, f, 3, { custom_id: control(reply, "task"), values: ["0"] })).reply!;
  reply = (await send(request, f, 3, { custom_id: control(reply, "priority"), values: ["none"] })).reply!;
  reply = (await send(request, f, 3, { custom_id: control(reply, "status"), values: ["open"] })).reply!;
  const modal = await send(request, f, 3, { custom_id: control(reply, "title") });
  expect(modal.ack.data.components[0].components[0].value).toBe("Sort out train coverage");
  reply = (await send(request, f, 5, { custom_id: modal.ack.data.custom_id, components: [{ type: 1, components: [{ type: 4, custom_id: "value", value: "Reviewed train coverage" }] }] })).reply!;
  reply = (await send(request, f, 3, { custom_id: control(reply, "back") })).reply!;
  reply = (await send(request, f, 3, { custom_id: control(reply, "attention"), values: ["none"] })).reply!;
  const saveId = control(reply, "save");
  reply = (await send(request, f, 3, { custom_id: saveId })).reply!;
  expect(reply.content).toContain("Private note saved with 1 task");
  await send(request, f, 3, { custom_id: saveId });
  const notes = await sql`SELECT id, source, priority, intake_provenance FROM performance_notes WHERE alliance_id = ${f.alliance.allianceId}`;
  const tasks = await sql`SELECT title, status, priority, intake_provenance FROM officer_action_items WHERE alliance_id = ${f.alliance.allianceId}`;
  expect(notes).toHaveLength(1); expect(tasks).toHaveLength(1);
  expect(notes[0]).toMatchObject({ source: "discord", priority: null });
  expect(tasks[0]).toMatchObject({ title: "Reviewed train coverage", status: "open", priority: null, intake_provenance: { modes: { priority: "manual", status: "manual", title: "manual" } } });
  expect(tasks[0].intake_provenance.interpreter).toContain("notes-intake-v1");
  expect((await request.get(`/api/notes/${notes[0].id}`, { headers: { Cookie: authCookieHeader(f.peer) } })).status()).toBe(404);
});

test("Discord-only drafts bind once, preserve Discord source through web save, and cannot be stolen by relinking", async ({ request }) => {
  const f = await fixture(false);
  const sql = getE2eSql();
  const reply = (await send(request, f, 2, { name: "note", options: [{ name: "text", type: 3, value: "Private Discord thought" }] })).reply!;
  expect(reply.content).toContain("Run `/link`");
  const id = control(reply, "save").split(":")[2];
  await sql`INSERT INTO discord_hq_links (discord_user_id, hq_user_id, linked_at) VALUES (${f.authorDiscord}, ${f.author.hqUserId}, now())`;
  const headers = { Cookie: authCookieHeader(f.author) };
  const draftResponse = await request.get(`/api/notes/drafts/${id}`, { headers });
  expect(draftResponse.status()).toBe(200);
  const draft = await draftResponse.json();
  const saved = await request.post("/api/notes/capture", { headers, data: { ...draft.state.fields, draftId: id, expectedDraftVersion: draft.version, requestId: nanoid() } });
  expect(saved.status(), await saved.text()).toBe(200);
  const { note } = await saved.json();
  expect(note.source).toBe("discord");
  await sql`UPDATE discord_hq_links SET hq_user_id = ${f.peer.hqUserId} WHERE discord_user_id = ${f.authorDiscord}`;
  expect((await request.get(`/api/notes/${note.id}`, { headers: { Cookie: authCookieHeader(f.peer) } })).status()).toBe(404);
  const stolen = (await send(request, f, 3, { custom_id: control(reply, "save") })).reply!;
  expect(stolen.content).toContain("unavailable");
});
