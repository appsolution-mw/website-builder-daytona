import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Allow any dev origin: the host serves the iframe at unpredictable
  // hosts/IPs depending on runtime — 127.0.0.1:<port> (worker-pool-local)
  // and Caddy-fronted *.preview.<domain> on Hetzner. The container is
  // dev-only and reachable only via published port, so this is safe.
  allowedDevOrigins: ["*"],
};

export default nextConfig;
