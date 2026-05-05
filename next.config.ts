import type { NextConfig } from "next";

function csvEnv(value: string | undefined): string[] | undefined {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries && entries.length > 0 ? entries : undefined;
}

const nextConfig: NextConfig = {
  devIndicators: false,
  // Pin Turbopack to this directory. Without it, Next.js walks up looking
  // for the nearest lockfile and finds /Volumes/Extern/Projekte/pnpm-lock.yaml
  // (a stray parent file), then can't resolve our deps.
  allowedDevOrigins: csvEnv(process.env.NEXT_ALLOWED_DEV_ORIGINS),
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
