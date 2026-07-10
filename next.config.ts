import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
  serverExternalPackages: [
    "jose",
    "@gear-js/api",
    "@polkadot/api",
    "sails-js",
  ],
  experimental: {
    optimizePackageImports: ["viem", "wagmi", "@tanstack/react-query"],
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      porto: false,
      "porto/internal": false,
      accounts: false,
      "node:assert": require.resolve("assert/"),
      "node:buffer": require.resolve("buffer/"),
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        assert: require.resolve("assert/"),
        buffer: require.resolve("buffer/"),
      };
    }

    return config;
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
