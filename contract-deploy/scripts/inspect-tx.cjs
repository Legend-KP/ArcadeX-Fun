const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

dotenv.config({ path: path.resolve(__dirname, "../../../arcadex-celo/.env") });

const TX = process.argv[2] || "0xe2c30b7f05771453fe4d4e85a7161c2de5fe4d86b5445b0e10aaeb370ccc6ff1";
const ADDR = process.argv[3] || "0xa3ff9C5f592e2891279b83f9017C00733A3F19fC";

(async () => {
  const rpcs = [
    process.env.BASE_RPC_URL,
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://1rpc.io/base",
  ].filter(Boolean);

  for (const rpc of rpcs) {
    console.log("\nRPC", rpc);
    try {
      const p = new ethers.JsonRpcProvider(rpc, 8453);
      const receipt = await p.getTransactionReceipt(TX);
      console.log("receipt status", receipt?.status, "contractAddress", receipt?.contractAddress);
      console.log("gasUsed", receipt?.gasUsed?.toString(), "logs", receipt?.logs?.length);
      const code = await p.getCode(ADDR);
      console.log("getCode len", code?.length, code?.slice(0, 20));
      if (receipt?.contractAddress) {
        const code2 = await p.getCode(receipt.contractAddress);
        console.log("code at receipt.contractAddress len", code2?.length);
      }
    } catch (e) {
      console.log("error", e.message);
    }
  }
})();
