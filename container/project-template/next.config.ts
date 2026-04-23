import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.daytonaproxy01.eu", "*.daytona.app"],
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
