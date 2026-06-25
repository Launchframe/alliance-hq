# Discord Auth Developer Workflow

Use this workflow to test Discord auth without waiting on a deployed Discord bot for every change. It covers the signed webhook route, `/discord/authorize`, and a final live Discord smoke test.

## What This Covers

- `/link` with no options: Discord returns a browser URL, and the browser form asks for in-game name + UID.
- `/link name:... uid:...`: links a commander inline without `discord_hq_links`.
- `/link-alliance tag:...`: binds a guild when the caller is proven as owner by member link or platform maintainer.
- `/link-to-ashed-seat tag:...`: still opens the Ashed connection-key flow.
- Bad signatures, unregistered guilds, wrong names, used/expired nonces, and UID conflicts.

## Local Setup

Add local-only values to `.env.local`:

```bash
LOCAL_DATABASE_URL=postgresql://localhost/alliance_hq_dev
TOKEN_ENCRYPTION_KEY=<openssl rand -hex 32>
AUTH_SECRET=<openssl rand -base64 32>
NEXT_PUBLIC_APP_URL=http://localhost:5175
E2E_TEST=true
```

Generate a local Ed25519 keypair for signed synthetic interactions:

```bash
npm run discord:dev:keygen
```

Copy the printed values into `.env.local`:

```bash
DISCORD_PUBLIC_KEY=<printed public key>
DISCORD_DEV_PRIVATE_KEY=<printed private key>
DISCORD_DEV_GUILD_ID=dev-guild-1
DISCORD_DEV_USER_ID=dev-user-1
```

These keys are for local testing only. Do not use them for a real Discord application.

## Seed the Local Fixture

Prepare and seed the database:

```bash
npm run db:prepare
npm run discord:dev:seed-auth
```

The seed creates:

- Alliance tag `DEV` in native mode
- Guild id `dev-guild-1` bound to the alliance
- Discord user id `dev-user-1`
- Owner roster member `ColdStartOwner`
- UID `1234567890121203`

`E2E_TEST=true` makes the Last War lookup return `ColdStartOwner` for that UID.

## Start the App

```bash
npm run dev
```

The app listens on `http://localhost:5175`.

## Fast Signed Webhook Loop

Ping the webhook:

```bash
npm run discord:dev:ping
```

Expected response:

```json
{ "type": 1 }
```

Ask Discord `/link` for a browser URL:

```bash
npm run discord:dev:slash -- link
```

The helper prints the Discord response and extracts the authorize URL when present. Open that URL in the browser and submit:

- In-game name: `ColdStartOwner`
- Player UID: `1234567890121203`

Test inline `/link` without the browser:

```bash
npm run discord:dev:slash -- link name=ColdStartOwner uid=1234567890121203
```

Test guild registration after owner link:

```bash
npm run discord:dev:slash -- link-alliance tag=DEV
```

Test that Ashed remains a separate optional flow:

```bash
npm run discord:dev:slash -- link-to-ashed-seat tag=DEV
```

That command should return a `/discord/authorize` URL whose browser form asks for an Ashed connection key.

## Browser Auth Loop

For `/link`:

1. Run `npm run discord:dev:slash -- link`.
2. Open the printed authorize URL.
3. Confirm the form asks for name + UID, not an Ashed key.
4. Submit `ColdStartOwner` and `1234567890121203`.
5. Confirm success text references the linked commander.
6. Optional DB check:

```sql
select discord_user_id, member_display_name, game_uid
from discord_member_links
where alliance_id = 'dev-discord-auth-alliance';
```

For `/link-to-ashed-seat`:

1. Run `npm run discord:dev:slash -- link-to-ashed-seat tag=DEV`.
2. Open the printed authorize URL.
3. Confirm the form asks for an Ashed connection key.

## Negative Checks

Run these before shipping Discord auth changes:

- Bad signature: change `DISCORD_PUBLIC_KEY` without changing `DISCORD_DEV_PRIVATE_KEY`; `npm run discord:dev:ping` should return `401`.
- Unregistered guild: `npm run discord:dev:slash -- link --guild-id unknown-guild`; response should ask owner to register the guild.
- Wrong name: `npm run discord:dev:slash -- link name=Wrong uid=1234567890121203`; response should ask the user to retry or continue in Discord for button-based steps.
- UID already linked: link once as `dev-user-1`, then run the same command with `--user-id dev-user-2`; response should say the commander is already linked.
- Used nonce: submit the same `/discord/authorize?nonce=...` twice; second attempt should report expired or already used.
- Connection key boundary: `/link` must never show an Ashed key field; `/link-to-ashed-seat` must never accept name + UID as a credential substitute.

## Live Discord Smoke

Use this only for final confidence:

1. Create or reuse a Discord dev application and a private dev guild.
2. Set local env:

```bash
DISCORD_APPLICATION_ID=<dev app id>
DISCORD_PUBLIC_KEY=<dev app public key>
DISCORD_BOT_TOKEN=<dev bot token>
DISCORD_GUILD_ID=<dev guild id>
NEXT_PUBLIC_APP_URL=<tunnel https URL>
```

3. Start the app on port `5175`.
4. Start a tunnel to `http://localhost:5175`.
5. In the Discord Developer Portal, set Interactions Endpoint URL to:

```text
<tunnel https URL>/api/webhooks/discord/interactions
```

6. Register commands:

```bash
npm run discord:register-commands
```

7. In the dev guild, run the same smoke checklist:

- `/link` opens the name + UID browser flow.
- `/link name:... uid:...` links inline.
- `/link-alliance tag:...` works for an owner proven by member link.
- `/link-to-ashed-seat tag:...` opens the Ashed key form.

## Troubleshooting

- `401 Invalid request signature`: `DISCORD_PUBLIC_KEY` does not match `DISCORD_DEV_PRIVATE_KEY`, or the live Discord app public key is not loaded.
- `DISCORD_PUBLIC_KEY is not configured`: the app process did not load `.env.local`.
- `/link` says guild is not registered: run `npm run discord:dev:seed-auth` or use the same guild id in `DISCORD_DEV_GUILD_ID`.
- Last War lookup fails for the fixture UID: set `E2E_TEST=true` in the app process.
- Live command updates are stale: set `DISCORD_GUILD_ID` before `npm run discord:register-commands` for guild-scoped fast propagation.
