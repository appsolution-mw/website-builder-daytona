---
name: frontend-design
description: Use when designing or rebuilding any UI surface — picking a layout grid, defining a type scale, setting spacing, adding hover/focus states, or doing an accessibility quick-pass on a page or component.
---

# Frontend design

Apply these principles whenever you create or restructure a visual surface.

## Layout

- **Marketing pages** (landing, pricing, about): use a 12-column grid for hero/feature sections. Keep content max-width around `max-w-6xl` to `max-w-7xl` and centre it. Constrain prose to `max-w-prose` (~65ch) for readability.
- **Dashboard / app surfaces**: prefer flex or CSS grid with explicit column tracks (`grid-cols-[260px_1fr]` for sidebar + main). Don't force a 12-col grid where the layout is intrinsically two- or three-pane.
- **Forms and short content**: a 6-col grid (or just flex column) is usually enough.
- Default to mobile-first. Stack on small screens, split at `md:` or `lg:`.

## Typography

- Base size `1rem` (16px). Pick one ratio and stick to it — `1.125` (minor second) for dense UI, `1.25` (major third) for marketing.
- Three weights at most per surface (e.g. 400, 500, 700). Don't mix five.
- Line height: `1.5` for body, `1.1`–`1.25` for headings.
- One display font + one sans-serif system stack is plenty. Load via `next/font`.

## Spacing

- Stick to Tailwind's spacing scale (4px base). Don't sprinkle arbitrary `[13px]` values.
- Vertical rhythm: section padding `py-16` to `py-24` on marketing, `py-6` to `py-8` inside dashboards.
- Card/container padding: `p-4` (compact), `p-6` (standard), `p-8` (spacious).

## Common pitfalls to avoid

- Centring everything on the page — alignment creates hierarchy, centred-everything erases it.
- Low contrast (`text-gray-400` on white = unreadable). Aim for WCAG AA: 4.5:1 for body, 3:1 for large text.
- No visible focus state. Every interactive element needs `focus-visible:ring-2` or equivalent.
- Hover states only on desktop — make sure focus and active states also look distinct.

## Accessibility quick-pass

Before declaring a page done:

1. Tab through it. Every interactive element must be reachable, in logical order, with a visible focus ring.
2. Check colour contrast on text and on focus indicators.
3. Confirm all `<img>` have `alt`, all inputs have associated `<label>`, all icon-only buttons have `aria-label`.
4. If the project has `axe-core` available, run it; otherwise the manual pass above is the floor.
