require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
require("dotenv").config({
  path: require("path").resolve(__dirname, "../../arcadex-celo/.env"),
});

let privateKey = (process.env.PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
if (privateKey && !privateKey.startsWith("0x")) {
  privateKey = `0x${privateKey}`;
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: privateKey ? [privateKey] : [],
    },
    avalanche: {
      url:
        process.env.AVALANCHE_RPC_URL ||
        "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts: privateKey ? [privateKey] : [],
    },
  },
  etherscan: {
    // Etherscan API V2 — one key works across supported chains (incl. Avalanche 43114).
    apiKey:
      process.env.ETHERSCAN_API_KEY ||
      process.env.SNOWTRACE_API_KEY ||
      process.env.BASESCAN_API_KEY ||
      "",
    customChains: [
      {
        network: "avalanche",
        chainId: 43114,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=43114",
          browserURL: "https://snowtrace.io",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};
