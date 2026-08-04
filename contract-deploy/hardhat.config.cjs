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
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || "",
  },
  sourcify: {
    enabled: false,
  },
};
