import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow any dev origin: the host serves the iframe at unpredictable
  // hosts/IPs depending on runtime — Daytona preview URLs, 127.0.0.1:<port>
  // (worker-pool-local), and later Caddy-fronted *.preview.<domain> in H.1d.
  // The container is dev-only and reachable only via published port, so this
  // is safe.
  allowedDevOrigins: ["*"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Daytona-Skip-Preview-Warning", value: "true" }],
      },
    ];
  },
};

export default nextConfig;
