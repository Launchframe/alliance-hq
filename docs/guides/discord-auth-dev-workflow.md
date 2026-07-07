# Discord Auth Developer Workflow

Use this workflow to test Discord auth without waiting on a deployed Discord bot for every change. It covers the signed webhook route, `/discord/authorize`, and a final live Discord smoke test.

## What This Covers

- **Install wizard** (`/discord/setup`): primary path — HQ sign-in, Discord link, tag, Ashed walkthrough, bot OAuth with redirect to `/discord/install/complete` (auto-registers the guild).
- `/link` with no options: Discord returns a browser URL; the browser page starts **Discord OAuth** to bind `discord_hq_links` (recovery when the wizard was skipped).
- `/link-commander` (or `/link-last-war-profile`): returns a secure HTTPS link to enter player ID in a registered guild.
- `/link-alliance tag:...`: binds a guild when the caller is proven as owner by member link or platform maintainer.
- `/link-ashed tag:...`: opens the Ashed connection-key flow (requires HQ link from `/link` first).
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

If `ELIGIBLE_BOT_ALLIANCE_LINK_TAGS` is set in your `.env.local` (it gates `/link-alliance` and `/link-ashed`), the seed's `DEV` tag must be in the list, otherwise those commands return "Alliance tag **DEV** is not currently eligible for bot setup on this deployment." Either add `DEV` or remove the variable so every tag is allowed:

```bash
# include DEV alongside any existing tags, e.g. ELIGIBLE_BOT_ALLIANCE_LINK_TAGS=LFgo,DEV
ELIGIBLE_BOT_ALLIANCE_LINK_TAGS=DEV
# or leave it unset entirely to allow all tags
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

## Discord Developer Portal — bot install redirect

When using the **install wizard**, register this OAuth2 redirect URI on your Discord application (same app as `DISCORD_APPLICATION_ID` / `AUTH_DISCORD_ID`):

```text
{NEXT_PUBLIC_APP_URL}/discord/install/complete
```

Local example: `http://localhost:5175/discord/install/complete`

Production: `https://your-hq-domain/discord/install/complete`

Without this redirect, the wizard’s **Add bot to Discord** step completes in Discord but cannot register the guild on HQ.

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

### Dev Last War lookup UIDs (`E2E_TEST=true`)

Requires `E2E_TEST=true` in `.env.local` and a dev server restart.

| UID | Lookup name | Use |
| --- | --- | --- |
| `1234567890121203` | `ColdStartOwner` | Owner cold start, Discord dev seed |
| `1234567890121204` | `E2eRosterMiss` | Roster miss / officer help queue |
| `1234567890121205` | `E2eWrongServer` | Wrong-server onboarding (non-claim) |
| `1234567890121206` | `Mew2407` | Substring roster match |
| `1234567890121299` | `E2eClaimTarget` | Playwright claim invite (fixed name) |
| **`1234567890121288`** | *(mirrors invite)* | **Manual claim testing — lookup name always matches the invited commander** |

For claim-invite happy paths in a private window, use **`1234567890121288`**. You can reuse it for every invite without burning fixed-name UIDs. Conflict scenarios still use the other fixtures (e.g. `1204` roster miss, `1205` wrong name if you enter a UID that does not mirror).

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

Ask Discord `/link` for an HQ-login browser URL (works even without a registered guild):

```bash
npm run discord:dev:slash -- link
```

The helper prints the Discord response and extracts the authorize URL when present. Open that URL in the browser and complete **Continue with Discord** OAuth (same Discord account as the synthetic caller when testing locally).

Test inline commander link in a registered guild:

```bash
npm run discord:dev:slash -- link-commander name=ColdStartOwner uid=1234567890121203
```

Test guild registration after owner commander link:

```bash
npm run discord:dev:slash -- link-alliance tag=DEV
```

This must succeed **without** Ashed credentials: the prior `/link-commander name=ColdStartOwner uid=…` created a member link whose in-game member matches the alliance owner, which proves ownership for native alliances. Expect `Registered this server for **DEV**.` Run the inline owner `/link-commander` first — registration is denied if the caller has no owner member link (and is not a platform maintainer or credential registrant).

Test that Ashed remains a separate optional flow:

```bash
npm run discord:dev:slash -- link-ashed tag=DEV
```

That command should return a `/discord/authorize` URL whose browser form asks for an Ashed connection key (after `/link` has created `discord_hq_links`).

## Browser Auth Loop

For `/link` (HQ account):

1. Run `npm run discord:dev:slash -- link`.
2. Open the printed authorize URL.
3. Confirm the page offers **Continue with Discord**, not name + UID or an Ashed key.
4. Complete OAuth and land on the success/complete page.
5. Optional DB check:

```sql
select discord_user_id, hq_user_id
from discord_hq_links
where discord_user_id = 'dev-user-1';
```

For `/link-commander`:

1. Run `npm run discord:dev:slash -- link-commander name=ColdStartOwner uid=1234567890121203`.
2. Confirm success references the linked commander.
3. Optional DB check:

```sql
select discord_user_id, member_display_name, game_uid
from discord_member_links
where alliance_id = 'dev-discord-auth-alliance';
```

For `/link-ashed`:

1. Ensure `discord_hq_links` exists for the caller (run `/link` + OAuth first).
2. Run `npm run discord:dev:slash -- link-ashed tag=DEV`.
3. Open the printed authorize URL.
4. Confirm the form asks for an Ashed connection key.

## Roster-miss queue (with and without an HQ link)

When `/link-commander` verifies a commander but the in-game name does not match the alliance roster, the bot routes the attempt to the officer roster-link queue (`/members/roster-link-requests` in HQ) instead of dead-ending:

- **Discord user has an HQ link** (`discord_hq_links` row): the request is created with that `hq_user_id`. The bot reply is `discordBot.link.awaitingOfficerResolve`. Resolving the request links both the HQ member and the Discord member.
- **Discord user has no HQ link**: the request is still created, with `hq_user_id = NULL` (Discord-only). The bot reply is `discordBot.link.awaitingOfficerResolveNoHq`, which explains officers were notified and the user can link an HQ account later via `/link`. Resolving the request binds only the Discord member (`discord_member_links`) to the chosen roster member.

Both paths compute the single-substring suggestion (`findUniqueSubstringRosterCandidate`) and persist `suggested_target_ashed_member_id` / `suggested_matched_roster_name` so officers see a preselected match. Re-running `/link-commander` supersedes prior pending requests by every identity available: `hq_user_id` when present, `discord_user_id` when present, or both after a Discord user later links HQ.

## Negative Checks

Run these before shipping Discord auth changes:

- Bad signature: change `DISCORD_PUBLIC_KEY` without changing `DISCORD_DEV_PRIVATE_KEY`; `npm run discord:dev:ping` should return `401`.
- Unregistered guild commander link: `npm run discord:dev:slash -- link-commander name=ColdStartOwner uid=1234567890121203 --guild-id unknown-guild`; response should ask owner to register the guild.
- Wrong name: `npm run discord:dev:slash -- link-commander name=Wrong uid=1234567890121203`; response should ask the user to retry or continue in Discord for button-based steps.
- UID already linked: link once as `dev-user-1`, then run the same command with `--user-id dev-user-2`; response should say the commander is already linked.
- Used nonce: submit the same `/discord/authorize?nonce=...` twice; second attempt should report expired or already used.
- Connection key boundary: `/link` must never show an Ashed key field; `/link-ashed` must never accept name + UID as a credential substitute.

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

- `/link` opens the Discord OAuth browser flow (no alliance required).
- `/link-commander` returns a secure link to enter player ID in a registered guild.
- `/link-alliance tag:...` works for an owner proven by member link.
- `/link-ashed tag:...` opens the Ashed key form after HQ link.

## Troubleshooting

- `401 Invalid request signature`: `DISCORD_PUBLIC_KEY` does not match `DISCORD_DEV_PRIVATE_KEY`, or the live Discord app public key is not loaded.
- `DISCORD_PUBLIC_KEY is not configured`: the app process did not load `.env.local`.
- `Alliance tag DEV is not currently eligible for bot setup`: `ELIGIBLE_BOT_ALLIANCE_LINK_TAGS` is set and does not include `DEV` — add `DEV` to the list or unset the variable, then restart the app process.
- `/link-commander` says guild is not registered: run `npm run discord:dev:seed-auth` or use the same guild id in `DISCORD_DEV_GUILD_ID`.
- Last War lookup fails for the fixture UID: set `E2E_TEST=true` in the app process.
- Live command updates are stale: set `DISCORD_GUILD_ID` before `npm run discord:register-commands` for guild-scoped fast propagation.
