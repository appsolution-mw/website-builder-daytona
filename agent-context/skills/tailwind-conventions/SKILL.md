---
name: tailwind-conventions
description: Use when writing Tailwind utility classes — deciding utility ordering, responsive prefixes, dark-mode strategy, when to extract a component class, or when an arbitrary value is justified.
---

# Tailwind conventions

Keep class lists short, ordered, and scannable.

## Utility ordering

Order classes by category. Pick one convention and stick to it across the file:

1. **Layout** — `flex`, `grid`, `block`, `hidden`, `relative`, `absolute`, `inset-*`, `z-*`
2. **Box / sizing** — `w-*`, `h-*`, `max-w-*`, `min-h-*`
3. **Spacing** — `p-*`, `px-*`, `m-*`, `gap-*`
4. **Typography** — `text-*`, `font-*`, `leading-*`, `tracking-*`
5. **Color / background / border** — `bg-*`, `text-{color}-*`, `border`, `border-*`, `ring-*`, `shadow-*`, `rounded-*`
6. **State / variant** — `hover:*`, `focus-visible:*`, `disabled:*`, `dark:*`
7. **Responsive** at the end of each cluster: `md:*`, `lg:*`

Example: `flex items-center gap-3 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus-visible:ring-2`.

## Responsive

Mobile-first. Unprefixed = base/mobile, then `sm:`, `md:`, `lg:`, `xl:` add overrides upward. Don't write `max-md:` unless you genuinely need a desktop-first override.

## Dark mode

Default to **media-query-based** (`darkMode: 'media'` in `tailwind.config.ts`, or omit — that's the default) unless the user explicitly wants a manual toggle. Then use `dark:` variants:

```tsx
<div className="bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100" />
```

Only switch to `darkMode: 'class'` if the user asks for a theme switcher.

## Arbitrary values

Avoid `[13px]` and `[#abc123]`. Reach for them only when:

- A design spec gives an exact pixel value the scale doesn't cover.
- You're matching an external brand colour exactly.

If you find yourself reaching for arbitrary values often, define design tokens in `tailwind.config.ts` instead.

## When to extract

`@apply` is rarely the answer. Extract a **React component** instead — that's the natural unit of reuse in this stack. Use `@apply` only for tiny base-layer rules in `globals.css` (e.g. setting body defaults).

## Keep it short

If a class list passes ~12 utilities, consider whether the element is doing too much, or whether a wrapper component would clarify intent. Use `clsx` or `cn()` helpers when toggling classes conditionally — don't string-concatenate.
