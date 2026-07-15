---
name: theme-audit
description: Audit and fix light/dark mode issues across components — scan for hardcoded dark-only colors, apply dual-mode patterns, and verify compilation. Use when the user reports unreadable UI in light or dark mode, or asks for a theme audit.
---

# Theme audit

Systematically find and fix components that only look correct in one theme (typically dark mode). Run this skill when the user reports unreadable text, invisible controls, or broken gradients in light or dark mode.

## Phase 1: Scan

Search the target files for hardcoded Tailwind color classes that lack a `dark:` counterpart. Common offenders:

### Bare dark-mode-only background + text

```bash
# Background tints that disappear on white
rg 'bg-(blue|cyan|violet|emerald|amber|red|green|purple|orange|pink|yellow)-\d00/\d' --glob '*.tsx' --glob '*.ts' -l

# Light text that vanishes on white
rg 'text-(blue|cyan|violet|emerald|amber|red|green|purple|orange|pink|yellow)-(100|200|300)' --glob '*.tsx' --glob '*.ts' -l

# Border tints
rg 'border-(blue|cyan|violet|emerald|amber|red|green|purple|orange|pink|yellow)-\d00/\d' --glob '*.tsx' --glob '*.ts' -l
```

### Inline style with hardcoded hex

```bash
rg 'style=.*#[0-9a-fA-F]{6}' --glob '*.tsx' -l
rg 'linear-gradient' --glob '*.tsx' -l
```

### Missing dark: variant

For each match from the scan, check whether a corresponding `dark:` class exists on the same element. If not, the element is a candidate for repair.

**Exclusions (skip these):**

- Files under `node_modules/`, `.next/`, `dist/`
- Classes inside `MECHANISM_STYLES`, `TEMPLATE_CELL_STYLES`, or similar canonical maps that are already audited
- Decorative elements that intentionally do not flip with theme (document the exception)
- `hq-*` token classes (these are already dual-mode by definition)

## Phase 2: Fix

For each identified file, apply the dual-mode pattern from `hq-theming.mdc` § Domain-colored components:

| Layer | Light mode | Dark mode |
| --- | --- | --- |
| Background | Solid pastel (`bg-cyan-100`) | Translucent tint (`dark:bg-cyan-500/10`) |
| Text | Dark hue (`text-cyan-700`) | Light hue (`dark:text-cyan-100`) |
| Border | Mid hue (`border-cyan-500`) | Same or translucent (`dark:border-cyan-500/30`) |
| Link / CTA | Readable hue (`text-cyan-600`) | Light hue (`dark:text-cyan-300`) |

### Gradient overlays

Replace inline `style` gradients with Tailwind classes:

```
# Before (dark-only)
style={{ background: "linear-gradient(to bottom, #0d1117, transparent)" }}

# After (dual-mode)
className="bg-gradient-to-b from-white dark:from-[#0d1117] via-white/60 dark:via-[#0d1117]/60 to-transparent dark:to-transparent"
```

### Canonical style maps

If the offending classes are in `MECHANISM_STYLES` or `TEMPLATE_CELL_STYLES`, fix them in the map — every consumer benefits at once.

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
