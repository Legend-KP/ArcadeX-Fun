import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "path";

const stubsDir = path.join(__dirname, "lib/stubs");

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
  // Do NOT externalize @polkadot/api or @gear-js/api on Cloudflare —
  // externals get copied into the Worker and blow past the 3 MiB free limit.
  serverExternalPackages: ["jose"],
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

    // Server Worker: stub heavy Substrate packages (type metadata alone is multi‑MB).
    // Client bundles still use the real packages for Vara wallet UX.
    if (isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@gear-js/api": path.join(stubsDir, "gear-api.ts"),
        "@polkadot/api": path.join(stubsDir, "polkadot-api.ts"),
        "@polkadot/types": false,
        "sails-js": path.join(stubsDir, "sails-js.ts"),
      };
    }

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
