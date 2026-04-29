# AGENTS.md

## Project Context

- This project is a Next.js 16 App Router application running from `/workspace/project`.
- The preview renders the Next.js app, not a standalone HTML file.
- User-facing page work belongs in `app/`, `components/`, `lib/`, and `public/`.
- For the main page, edit `app/page.tsx` and related styles. Do not create or rely on a root `index.html` unless explicitly asked.
- This is not older Next.js: read the relevant guide in `node_modules/next/dist/docs/` before using framework APIs, routes, config, middleware/proxy, or runtime behavior.

## Commands

- Use `pnpm`.
- The sandbox manages the dev server. Do not start a second long-running server unless explicitly asked.
- Check TypeScript changes with `pnpm exec tsc --noEmit` when practical.

## Code Style

- Use TypeScript with strict types.
- Keep diffs small, focused, and maintainable.
- Prefer functional React components and App Router patterns.
- Preserve correct native spelling, including umlauts such as ä, ö, ü, and ß.
- Animations and parallax effects must be progressive enhancement: primary text, navigation, cards, and CTAs must remain visible in the server-rendered HTML/CSS fallback. Do not leave important content at `opacity: 0` waiting for client-side animation or hydration.
