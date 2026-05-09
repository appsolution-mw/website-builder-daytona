---
name: nextjs-app-router
description: Use when working on Next.js routes, layouts, server components, server actions, data fetching, image/font optimization, or `proxy.ts` (which replaces `middleware.ts` in Next.js 16).
---

# Next.js 16 App Router

This project uses Next.js 16 with the App Router. Several conventions differ from older Next.js versions — read the relevant doc under `node_modules/next/dist/docs/` if you're unsure.

## File conventions

Inside `app/`:

- `page.tsx` — the route's UI.
- `layout.tsx` — wraps the route and its children. Must render `children`.
- `loading.tsx` — Suspense fallback for the segment.
- `error.tsx` — error boundary. Must be a Client Component.
- `not-found.tsx` — rendered when `notFound()` is called or no match.
- `route.ts` — Route Handler (real HTTP boundary, not a page).
- Dynamic segments: `[slug]`, catch-all `[...slug]`, optional catch-all `[[...slug]]`.
- Route groups: `(marketing)` — group without affecting URL.

## Server vs Client Components

- **Default is Server Component.** Use them for data fetching, accessing the database, reading env vars, and rendering markup.
- Add `"use client"` at the top of a file only when you need state (`useState`), effects (`useEffect`), browser APIs, or event handlers (`onClick`, `onChange`).
- A Server Component can import a Client Component, but not vice versa. Pass server data **down** via props.

## Server Actions vs Route Handlers

- **Server Actions** (functions marked `"use server"`) — for form submissions and mutations triggered from your own UI. Use them by default for internal mutations.
- **Route Handlers** (`route.ts`) — for real HTTP boundaries: webhooks, third-party callbacks, public APIs. Don't route internal data through `/api/*` if a Server Component or Server Action can do it directly.

## Data fetching and rendering

- `fetch()` in a Server Component is automatically deduped within a render. Pass `{ next: { revalidate: 60 } }` for ISR or `{ cache: 'no-store' }` for dynamic.
- `async/await` works directly inside Server Components — no `getServerSideProps`.
- `params` and `searchParams` are **async** in Next.js 16 — `await` them.
- If the project uses Cache Components, prefer `use cache` directives over ad-hoc `unstable_cache`.

## Middleware → `proxy.ts`

Next.js 16 renames `middleware.ts` to `proxy.ts`. Same API, same matchers config, just the new filename. Keep proxy logic small and matchers narrow.

## Optimization

- Images: always `import Image from 'next/image'`. Set `width`/`height` or use `fill` with a sized parent. Add `priority` only on the LCP image.
- Fonts: use `next/font/google` or `next/font/local`. Don't load fonts via `<link>`.
- Don't add polyfills — Next ships modern targets.
