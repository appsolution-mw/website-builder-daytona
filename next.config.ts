import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack to this directory. Without it, Next.js walks up looking
  // for the nearest lockfile and finds /Volumes/Extern/Projekte/pnpm-lock.yaml
  // (a stray parent file), then can't resolve our deps.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
