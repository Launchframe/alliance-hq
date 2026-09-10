# Calendar integration contracts

HQ remains the source of truth. Google connections manage only dedicated HQ-created calendars and mapped events; Apple subscriptions are read-only capability feeds. Account-wide alert offsets are shared across Commanders and memberships, with five distinct positive minute offsets at most. Existing Discord/HQ notification consent is independent.

## Time and audience

Regular start-only events default to 30 minutes. Explicit Plunder Plan/draft intervals are preserved. All-day source dates remain calendar DATE values, with an exclusive end; they are not guaranteed to span 24 elapsed hours across local DST changes.

A train's countdown starts at four hours; boarding ends with five minutes remaining. At observation T with remaining R seconds, opening is T-(14400-R), closing is T+(R-300). The resulting window is 14100 seconds. An explicit Skip uses the original HQ lock timestamp plus 14100 seconds as an estimate. Observation time and receipt identity are immutable through retries. Lock metadata never extends an observed window.

Boarding is an alliance-wide utility, not a personal conductor assignment. Every active opted-in alliance account may export the minimal boarding summary without gaining access to scores or privileged train mutations. Automatic nomination locks and history imports are not evidence of a live in-game train. Interactive timing intents are resumable; abandonment does not silently publish a maximum estimate. Already closed boarding windows do not become upcoming events.

No calendar API can retroactively deliver a before-start alert. Native apps control notification permissions, all-day alert interpretation and presentation. Apple controls subscription refresh and may miss an entire boarding window; Google calendars displayed in Apple Calendar are an alternative. Subscribing through both paths can duplicate events/alerts.

## Privacy and lifecycle

Connections require authenticated HQ ownership and current alliance access. Source-specific permissions and current Commander identity are rechecked off-session. No stored browser session, inferred email ownership, arbitrary calendar URL, player UID, private time-off notes or disciplinary content is an export authority.

Private feed links are bearer credentials. They are hashed for lookup, encrypted for owner-only redisplay, excluded from ordinary DTOs/logging, and revocable. Previously cached external copies cannot be guaranteed erased. Disconnect fences normal sync immediately; optional cleanup is limited to known HQ event bindings and may fail if provider consent is already revoked. Never delete an entire calendar containing possible user-added events.

Provider event operations are reconciled using durable identities and revisions. Google secondary-calendar creation can have an uncertain outcome; do not retry ambiguous creation blindly. Google reminder-only changes do not necessarily alter the event's `updated` field. A failed/partial source read is not an empty authoritative snapshot.

## Execution and verification

Use Node 24 (available locally through nvm); the default shell Node 18 is unsuitable. DB-backed work for this slice uses its own `alliance_hq_calendar_e2e_20260910` local database, not other worktrees' E2E databases. All database URL variables must resolve to that same test resource for builds/migrations/tests; `npm run build` itself runs migrations and seeds. Current main also requires pgvector. The local PostgreSQL 16 extension was installed from upstream pgvector v0.8.6 (commit `8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c`) using its PGXS make/install targets with `/opt/homebrew/opt/postgresql@16/bin/pg_config`; the Homebrew pgvector bottle targets PostgreSQL 17/18 instead. Reinstall the matching extension if the PostgreSQL keg is replaced. The test server must use `localhost` for both its bind hostname and browser origin: fixtures bind cookies to localhost, and differing Next/next-intl hostnames can cause a self-redirect loop. Mock external transport in automated tests. Provider setup, live account testing, production migration and public release require separate authorization.

Fresh-migration verification also exposed an older support-team fixture that set the required canonical game-server reference to NULL. Migration 0057 requires a reference and 0141 provides the canonical unknown server (number 0). The fixture now uses that unknown state, preserving the no-configured-game-server scenario without weakening production constraints. Video preview tests identify their specific accessible dialog instead of assuming no other app dialog can exist, and dismiss incidental release notes through the normal UI. A deterministic status-transition browser test also exposed a Time Off acknowledgement race: the review panel is correctly keyed by revision/status, but its success notice must live above that keyed boundary so a successful retry remains visible after refresh.

Source durations other than train boarding are export defaults, not newly inferred game mechanics. Calendar alert preferences are initially Off until the member chooses offsets. Future recurrence is bounded; interval schedules without an established anchor are not speculatively shifted with the request date. UI text uses the approved calendar copy and existing localized source labels.
