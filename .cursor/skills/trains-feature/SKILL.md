---
name: trains-feature
description: Checklist-driven guide for implementing new trains features — mechanisms, templates, guided flow, dashboard wiring, styling, i18n, wheel, server logic, and tests. Use when adding or changing train conductor/VIP mechanics, pool types, templates, or dashboard actions.
---

# Trains feature implementation checklist

Follow this checklist when implementing a new trains feature (mechanism, template, pool type, guided flow step, dashboard action, or wheel behavior). Not every section applies to every feature — skip sections that are irrelevant, but **read each heading** to confirm.

**Related rules:** [trains.mdc](../rules/trains.mdc) (domain + RBAC), [trains-simple-advanced-modes.mdc](../rules/trains-simple-advanced-modes.mdc) (guided vs advanced parity — lands with Simple Mode).

## 1. Mechanism / template definition

- [ ] Add new mechanism or template ids to `src/lib/trains/types.ts` (`CONDUCTOR_MECHANISMS`, `VIP_MECHANISMS`, `WEEK_TEMPLATES`, and `POOL_TYPES` when pool-based).
- [ ] Add day-of-week rules and safeguards in `src/lib/trains/templates.ts` (e.g. no VS on Monday — no Sunday scores); update `generateDayConfigForDate` / `generateWeekDayConfigs`, `mechanismNeedsWheel`, `conductorMechanismPoolType`, and `supportsManual*Pick` as needed.
- [ ] Define `WEEK_TEMPLATE_SEGMENTS` or composite `COMPOSITE_WEEK_TEMPLATES` entries in `src/lib/trains/week-template-registry.shared.ts` if adding a template.
- [ ] If composite, define `segments` with per-weekday segment templates (see `COMPOSITE_WEEK_TEMPLATES` in the registry).
- [ ] Add the template to `SELECTABLE_WEEK_TEMPLATES` (registry filters `WEEK_TEMPLATES`) if it should appear in the template picker.
- [ ] Update `inferWeekTemplateFromDayConfigs` in `TrainsDashboard.tsx` if the template should infer from painted days.

## 2. Spin source mapping

- [ ] Map the new mechanism to a spin source in `src/lib/trains/spin-source.shared.ts` (`conductorSpinSource` / `vipSpinSource`).
- [ ] Classify as `PoolSpinSource`, `VsLeaderboardSpinSource`, `DonationsLeaderboardSpinSource`, `EventLeaderboardSpinSource`, `PriceIsRightWeekdaySpinSource`, `PriceIsRightHeavyHitterSpinSource`, or `null` (manual pick / no wheel).
- [ ] If pool-based, define pool type in `POOL_TYPES` (`types.ts`) and wire pool creation/seeding in `service.ts`.

## 3. Guided flow integration (Simple Mode)

Canonical step order: `template → prerequisites → conductor → vip → lock → done`. See [trains-simple-advanced-modes.mdc](../rules/trains-simple-advanced-modes.mdc).

- [ ] Update `currentGuidedStep()` and `guidedFlowPrerequisitesBlocking()` in `src/lib/trains/guided-flow.shared.ts` if the feature adds or changes step gates.
- [ ] Update `classifyVsDataNeed()` / `buildVsDataStatus()` in `src/lib/trains/vs-data-status.shared.ts` when the mechanism needs VS or prior-day VS scores.
- [ ] Update `canSpinConductorForDay()` / `canSpinVipForDay()` in `src/lib/trains/conductor-mechanism.shared.ts` when spin eligibility changes.
- [ ] Update `mechanismNeedsWheel()` in `templates.ts` — does this mechanism spin or only manual pick?
- [ ] If the mechanism has score prerequisites, wire the blocking CTA on the `prerequisites` step in `TrainsGuidedConductorFlow.tsx` (link to `/tools/video-upload`).

## 4. Dashboard wiring (both modes)

**Guided mode:**

- [ ] Add the action to the appropriate guided flow step (`template`, `prerequisites`, `conductor`, `vip`, or `lock`).
- [ ] Render primary/secondary buttons per the mode contract (see `trains-simple-advanced-modes.mdc`).

**Advanced mode:**

- [ ] Add the equivalent control to the advanced quick-actions layout in `TrainsDashboard.tsx` (`data-testid="trains-quick-actions"`).
- [ ] If the feature has a prerequisite, add a hint banner (`data-testid="trains-upload-scores-banner"`) or `WheelBlockedDialog` recovery CTA in advanced mode.

**Shared:**

- [ ] Wire the action handler at the dashboard level, shared between both modes.
- [ ] Implement `router.refresh()` or client-side state update after the action completes.
- [ ] Register navigable dashboard actions in `src/lib/hotkeys/actions.registry.ts` when applicable.

## 5. Styling

- [ ] Add entries to `MECHANISM_STYLES` (`mechanism-styles.ts`) with both light and dark mode classes.
- [ ] Add entries to `TEMPLATE_CELL_STYLES` (`calendar-cell-styles.shared.ts`) if the template needs calendar cell styling.
- [ ] Follow the dual-mode pattern from `hq-theming.mdc` § Domain-colored components: solid pastel light, translucent tint dark.
- [ ] Spot-check in both light and dark themes.

## 6. I18n

- [ ] **Copy review:** present new English strings to the maintainer for approval before editing locale files (see [user-facing-copy-review.mdc](../rules/user-facing-copy-review.mdc)).
- [ ] Add approved translation keys to `messages/en-US.json` under `Trains` namespace.
- [ ] Add corresponding keys to `messages/pt-BR.json` in the same PR.
- [ ] Run `npm run i18n:validate` to verify both locales are in sync.
- [ ] If adding guided flow copy, use dynamic keys with `{count}` / `{pool}` interpolation where appropriate.

## 7. Wheel integration

- [ ] If the mechanism uses a wheel spin, verify the roll endpoint (`/api/trains/conductor/roll` or `/api/trains/conductor/vip/roll`) supports it.
- [ ] If score-based, ensure `RollCandidate` carries the score field and `ConductorWheelModal` displays it.
- [ ] Verify reel dedup logic in `conductor-wheel-reel.shared.ts` handles the candidate list size (≥ 3 unique names for viewport dedup).
- [ ] If the mechanism is manual-pick only, verify `supportsManualVipPick` / `supportsManualConductorPick` in `templates.ts` includes it.

## 8. Server-side logic

- [ ] Add or update the mechanism handler in `service.ts` (roll logic, pool queries, score queries).
- [ ] If pool-based, implement pool seeding and reseed logic.
- [ ] Ensure RBAC: conductor mutations use `requireTrainOfficer` (`trains:write`); reads use `requireSessionPermission(..., "scores:read")`.
- [ ] Tenant-scope all queries by session alliance.
- [ ] Keep client-safe helpers in `*.shared.ts`; mark server-only modules with `import "server-only"` — never import DB/session code from `"use client"` components.

## 9. Tests

- [ ] Add unit tests for the new mechanism/template in the appropriate `*.test.ts` files:
  - Template inference: `week-template-registry.shared.test.ts`
  - Guided flow: `guided-flow.shared.test.ts`
  - VS data readiness: `vs-data-status.shared.test.ts`
  - Spin source: `spin-source.shared.test.ts`
  - Optimistic updates: `optimistic-dashboard.shared.test.ts`
  - Server logic: `service.test.ts` or mechanism-specific test file
- [ ] Update `e2e/trains-*.spec.ts` when dashboard UX, RBAC gates, or guided/advanced parity changes.
- [ ] Run `npx tsc --noEmit` to verify type safety.
- [ ] Run `npm run lint`.
- [ ] Run `npm run test`.
- [ ] Run `npm run test:e2e` when flows or permissions change.

## 10. Documentation

- [ ] Update `.cursor/rules/trains.mdc` with the new mechanism/template details, including its conductor and VIP mechanisms, spin source, and any special rules.
- [ ] If the feature changes guided flow steps or mode parity, update `.cursor/rules/trains-simple-advanced-modes.mdc`.
