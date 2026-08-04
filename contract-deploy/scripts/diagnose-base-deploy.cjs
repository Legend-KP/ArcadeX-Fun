const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ path: path.resolve(__dirname, "../../../arcadex-celo/.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

let pk = (process.env.PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
if (!pk.startsWith("0x")) pk = `0x${pk}`;

const art = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../artifacts/contracts/ArcadeXRewards.sol/ArcadeXRewards.json"),
    "utf8"
  )
);
const code = art.deployedBytecode.replace(/^0x/, "");
console.log("ArcadeXRewards deployedBytecode bytes:", code.length / 2);
console.log("over 24576?", code.length / 2 > 24576);

const wallet = new ethers.Wallet(pk);
const provider = new ethers.JsonRpcProvider(
  process.env.BASE_RPC_URL || "https://mainnet.base.org",
  8453
);

(async () => {
  console.log("deployer", wallet.address);
  console.log("nonce", await provider.getTransactionCount(wallet.address));
  console.log("bal", ethers.formatEther(await provider.getBalance(wallet.address)));

  const url =
    "https://api.etherscan.io/v2/api?chainid=8453&module=account&action=txlist&address=" +
    wallet.address +
    "&page=1&offset=8&sort=desc";
  const res = await fetch(url);
  const j = await res.json();
  console.log("api", j.status, j.message);
  if (Array.isArray(j.result)) {
    for (const t of j.result.slice(0, 8)) {
      console.log(
        t.hash,
        "status",
        t.txreceipt_status,
        "to",
        t.to || "CREATE",
        "err",
        (t.isError || "0"),
        "gasUsed",
        t.gasUsed
      );
    }
  } else {
    console.log(String(JSON.stringify(j)).slice(0, 400));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
