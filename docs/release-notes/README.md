# Alliance HQ release notes

Author release notes in markdown under this directory, compile them from git history, publish to Vercel Edge Config, and ship with Discord announcements.

## Workflow

1. Copy `_template.md` to a new file (e.g. `2026-06-vr-bot.md`).
2. Add bullets under **Working notes** as you build the feature.
3. Compile the draft:

   ```bash
   npm run release:compile-note
   ```

4. Review the generated **Summary** section. Edit the markdown until `status: ready`.
5. Dry-run the ship:

   ```bash
   npm run release:ship -- --dry-run
   ```

6. Ship to production:

   ```bash
   npm run release:ship -- --yes
   ```

   This bumps `package.json`, marks the note `shipped`, publishes all shipped notes to Edge Config (`hqReleaseNotes`), posts to Discord, commits, pushes, and creates a GitHub release tag.

## Frontmatter

| Field | Values |
|-------|--------|
| `title` | Human-readable release title |
| `status` | `draft` → `ready` → `shipped` |
| `release_version` | Set automatically on ship |
| `shipped_at` | ISO timestamp, set on ship |

## Sections

- **Working notes** — your in-progress bullets (not shown in the app)
- **Summary** — compiled overview (shown in drawer, Discord, `/releases`)
- **Breaking changes** — optional bullet list
- **Platform maintainer notes** — optional bullet list for admins

## Environment

| Variable | Purpose |
|----------|---------|
| `EDGE_CONFIG` | Runtime read on Vercel |
| `EDGE_CONFIG_ID` + `VERCEL_API_TOKEN` | Publish during ship |
| `DISCORD_BOT_TOKEN` + `DISCORD_RELEASE_NOTES_CHANNEL_ID` | Discord announcement |
| `NEXT_PUBLIC_APP_URL` | Link to `/releases` in Discord |

Ship/publish scripts load `.env`, then `.env.local` (and `.env.development.local` in non-production), same as `db:migrate`.

## Re-publish only

```bash
npm run release-notes:publish -- --all-shipped
npm run release:notify-discord
```

## Backfill (one-time)

Reconstruct release notes for every production deploy already on `main`:

```bash
npm run release:backfill-main
npm run release-notes:publish -- --all-shipped
```

Optional annotated git tags: `npm run release:backfill-main -- --create-tags`

## In-app behavior

Signed-in users see an unread banner when their last-seen version is behind the deployed app version. The banner opens a release notes drawer; **Got it** or dismiss stores `hqLastSeenReleaseVersion:{sessionId}` in `localStorage`. Full history lives at `/releases`.
