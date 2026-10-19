import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "path";

const stubsDir = path.join(__dirname, "lib/stubs");

/**
 * Terser minifies `proving${'\0'}0` to `` `proving\00` ``, which OpenNext's
 * esbuild then rejects (legacy octal in template literals). Rewrite NUL octal
 * back to a unicode escape so the Worker can bundle.
 */
class FixTemplateOctalPlugin {
  apply(compiler: any) {
    compiler.hooks.compilation.tap("FixTemplateOctal", (compilation: any) => {
      compilation.hooks.processAssets.tap(
        {
          name: "FixTemplateOctal",
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        () => {
          for (const name of Object.keys(compilation.assets)) {
            if (!name.endsWith(".js")) continue;
            const asset = compilation.getAsset(name);
            if (!asset) continue;
            const text = asset.source.source().toString();
            if (!text.includes("\\00")) continue;
            const next = text.replace(/`proving\\00`/g, "`proving\\u00000`");
            if (next === text) continue;
            compilation.updateAsset(
              name,
              new compiler.webpack.sources.RawSource(next)
            );
          }
        }
      );
    });
  }
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
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

    if (isServer) {
      config.plugins = config.plugins || [];
      config.plugins.push(new FixTemplateOctalPlugin());

      // Stub heavy SDKs only when they are not imported by "use client" wallet
      // modules. Stubbing freighter / mysten / starknetkit breaks SSR analysis
      // of those client entrypoints ("Attempted import error: X is not exported").
      config.resolve.alias = {
        ...config.resolve.alias,
        "@stellar/stellar-sdk$": path.join(stubsDir, "empty.ts"),
        "@aptos-labs/ts-sdk$": path.join(stubsDir, "empty.ts"),
        siwe$: path.join(stubsDir, "empty.ts"),
        "get-starknet-core$": path.join(stubsDir, "empty.ts"),
        "@coinbase/wallet-sdk$": path.join(stubsDir, "empty.ts"),
        "@walletconnect/ethereum-provider$": path.join(stubsDir, "empty.ts"),
        "@walletconnect/core$": path.join(stubsDir, "empty.ts"),
        "@walletconnect/universal-provider$": path.join(stubsDir, "empty.ts"),
        "@metamask/connect-evm$": path.join(stubsDir, "empty.ts"),
        "@metamask/sdk$": path.join(stubsDir, "empty.ts"),
        "@wagmi/connectors$": path.join(stubsDir, "wagmi-connectors.ts"),
        "wagmi/connectors$": path.join(stubsDir, "wagmi-connectors.ts"),
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
