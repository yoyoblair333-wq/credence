import type { NextConfig } from "next";

// Static export so the dApp can be hosted on GitHub Pages (no server needed:
// every read/write goes from the browser straight to the GenLayer RPC).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {},
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
