import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "path";

const stubsDir = path.join(__dirname, "lib/stubs");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
  // Do NOT externalize @polkadot/@gear — that copies multi‑MB type metadata
  // into the Worker and exceeds Cloudflare's free 3 MiB limit.
  serverExternalPackages: ["jose"],
  experimental: {
    optimizePackageImports: ["viem", "wagmi", "@tanstack/react-query"],
  },
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    const assertPolyfill = require.resolve("assert/");
    const bufferPolyfill = require.resolve("buffer/");

    config.resolve.alias = {
      ...config.resolve.alias,
      porto: false,
      "porto/internal": false,
      accounts: false,
      "node:assert": assertPolyfill,
      "node:buffer": bufferPolyfill,
      assert: assertPolyfill,
      buffer: bufferPolyfill,
    };

    // Server Worker stubs — real packages stay in the browser bundle for Vara UX.
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@gear-js/api": path.join(stubsDir, "gear-api.ts"),
        "@polkadot/api": path.join(stubsDir, "polkadot-api.ts"),
        "@polkadot/types": path.join(stubsDir, "polkadot-types.ts"),
        "sails-js": path.join(stubsDir, "sails-js.ts"),
      };
    }

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        assert: assertPolyfill,
        buffer: bufferPolyfill,
        crypto: false,
        fs: false,
        net: false,
        tls: false,
        path: false,
        os: false,
        stream: false,
        http: false,
        https: false,
        zlib: false,
      };
    }

    return config;
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
