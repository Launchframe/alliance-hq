---
name: theme-audit
description: Audit and fix light/dark mode issues across components — scan for hardcoded dark-only colors, apply dual-mode patterns, and verify compilation. Use when the user reports unreadable UI in light or dark mode, or asks for a theme audit.
---

# Theme audit

Systematically find and fix components that only look correct in one theme (typically dark mode). Run this skill when the user reports unreadable text, invisible controls, or broken gradients in light or dark mode.

**Rule of thumb:** Generic chrome (surfaces, borders, warnings, errors) must use `hq-*` tokens from [`src/app/globals.css`](src/app/globals.css) — see [`.cursor/rules/hq-theming.mdc`](../../rules/hq-theming.mdc). Domain-colored train/mechanism hues are the exception; those need explicit light + `dark:` Tailwind classes.

## Phase 1: Scan

Search the target files for hardcoded Tailwind color classes that lack a light-mode counterpart (or lack `dark:` when only light classes exist). Common offenders:

### Bare dark-mode-only background + text

```bash
# Background tints that disappear on white (include slate — officer/custom mechanisms)
rg 'bg-(blue|cyan|violet|emerald|amber|red|green|purple|orange|pink|yellow|slate)-\d00/\d+' --glob '*.tsx' --glob '*.ts' -l src/

# Light text that vanishes on white
rg 'text-(blue|cyan|violet|emerald|amber|red|green|purple|orange|pink|yellow|slate)-(100|200|300)' --glob '*.tsx' --glob '*.ts' -l src/

# Border tints
rg 'border-(blue|cyan|violet|emerald|amber|red|green|purple|orange|pink|yellow|slate)-\d00(/\d+)?' --glob '*.tsx' --glob '*.ts' -l src/
```

### Inline style with hardcoded hex

```bash
rg 'style=.*#[0-9a-fA-F]{6}' --glob '*.tsx' -l src/
rg 'linear-gradient' --glob '*.tsx' -l src/
```

### Missing dual-mode variant

For each match, check whether the same element has **both** a readable light-mode class and a `dark:` counterpart. A lone `bg-blue-500/15 text-blue-200` (no light pastel) is a repair candidate.

**Exclusions (skip these):**

- Files under `node_modules/`, `.next/`, `dist/`
- `hq-*` token classes (already dual-mode via `:root` / `:root.dark`)
- Decorative elements that intentionally do not flip with theme (document the exception)
- Charts / data viz with a fixed palette documented next to the series config

**Canonical maps (fix here first, do not skip):** Legacy dark-biased entries in [`src/lib/trains/mechanism-styles.ts`](../../src/lib/trains/mechanism-styles.ts) (`MECHANISM_STYLES`) and [`src/lib/trains/calendar-cell-styles.shared.ts`](../../src/lib/trains/calendar-cell-styles.shared.ts) (`TEMPLATE_CELL_STYLES`, not exported). Repair the map — every consumer benefits. Do not patch individual components when the class string comes from these maps.

## Phase 2: Fix

### Generic chrome → `hq-*` tokens

Before adding Tailwind hue scales, check whether a semantic token fits:

| Role | Use |
| --- | --- |
| Surfaces | `bg-hq-canvas`, `bg-hq-surface`, `border-hq-border` |
| Text | `text-hq-fg`, `text-hq-fg-muted` |
| Status | `text-hq-warning`, `text-hq-danger`, `text-hq-success` |

If no token fits, add a CSS variable in both `:root` and `:root.dark`, wire it in `@theme inline`, then use the new `hq-*` class — do not ship one-off hex.

### Domain-colored components (mechanism / brand palettes)

When the hue carries domain meaning (cyan = Price Is Freight, blue = VS, purple = R4, etc.), apply the dual-mode pattern from [`.cursor/rules/hq-theming.mdc`](../../rules/hq-theming.mdc) **Domain-colored components**:

| Layer | Light mode | Dark mode |
| --- | --- | --- |
| Background | Solid pastel (`bg-blue-100`) | Translucent tint (`dark:bg-blue-500/15`) |
| Text | Dark hue (`text-blue-700`) | Light hue (`dark:text-blue-200`) |
| Border | Mid hue (`border-blue-500`) | Same or translucent (`dark:border-blue-500`) |
| Link / CTA | Readable hue (`text-cyan-600`) | Light hue (`dark:text-cyan-300`) |

Full example:

```
border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200
```

### Gradient overlays

Replace inline `style` gradients with Tailwind classes. Prefer `hq-canvas` over hardcoded dark hex:

```
# Before (dark-only)
style={{ background: "linear-gradient(to bottom, #0d1117, transparent)" }}

# After (dual-mode)
className="bg-gradient-to-b from-hq-canvas via-hq-canvas/60 to-transparent"
```

When a gradient must differ by theme, use `dark:` variants (`from-white dark:from-hq-canvas`) — never a single-theme inline hex.

### Canonical style maps

If offending classes live in `MECHANISM_STYLES` or `TEMPLATE_CELL_STYLES`, fix them in the map file — every consumer benefits at once.

## Phase 3: Verify

1. **TypeScript:** Run `npx tsc --noEmit` to confirm no type errors were introduced.
2. **Lint:** Run `npm run lint`.
3. **Tests:** Run `npm run test` to catch any snapshot or assertion regressions.
4. **Visual spot-check:** List the modified components for the maintainer to manually verify in both light and dark themes. Include the component name, file path, and a brief description of what was fixed.

## Reporting

After all phases, provide a summary:

```
## Theme audit results

### Fixed (N files)
| File | Issue | Fix |
| --- | --- | --- |
| PriceIsRightTicketsPanel.tsx | `text-cyan-100` on white bg | Added `text-cyan-700 dark:text-cyan-100` |

### Skipped (exceptions)
| File | Reason |
| --- | --- |
| ChartConfig.ts | Fixed palette for data viz (documented exception) |

### Manual verification needed
- [ ] PriceIsRightTicketsPanel.tsx — light mode ticket values
- [ ] TrainsGuidedConductorFlow.tsx — light mode CTAs
```
