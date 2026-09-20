import type { NextConfig } from "next";

const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // Suppress build checks during production export
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
} as NextConfig;

export default nextConfig;