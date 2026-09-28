import type { NextConfig } from "next";

// In production the Caddy gateway routes /api/* and /mlflow/* before requests reach
// Next.js. For `npm run dev`, set API_PROXY_TARGET (e.g. http://localhost:8080, the
// gateway started by docker compose) so the same relative URLs work locally.
const proxyTarget = process.env.API_PROXY_TARGET;

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    if (!proxyTarget) return [];
    return [
      { source: "/api/:path*", destination: `${proxyTarget}/api/:path*` },
      { source: "/mlflow/:path*", destination: `${proxyTarget}/mlflow/:path*` },
    ];
  },
};

export default nextConfig;
