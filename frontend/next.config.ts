import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: true,
  },
  // Turbopack defaults are sufficient for our stack (viem + wagmi v2 + Tailwind 4);
  // we don't need browser polyfills for fs/net/tls.
  turbopack: {},
};

export default nextConfig;
