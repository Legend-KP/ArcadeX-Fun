/**
 * Verify all Base mainnet deployments via Sourcify (+ Basescan if ETHERSCAN_API_KEY set).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../../arcadex-celo/.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") }); // ArcadeX-Fun/.env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const CHAIN_ID = 8453;
const apiKey =
  process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || "";

const JOBS = [
  {
    file: "arcadex-rewards-base-mainnet.json",
    identifier: "contracts/ArcadeXRewards.sol:ArcadeXRewards",
    sourceKey: "contracts/ArcadeXRewards.sol",
  },
  {
    file: "spark-refill-base-mainnet.json",
    identifier: "contracts/SparkRefill.sol:SparkRefill",
    sourceKey: "contracts/SparkRefill.sol",
  },
  {
    file: "score-submit-base-mainnet.json",
    identifier: "contracts/ScoreSubmit.sol:ScoreSubmit",
    sourceKey: "contracts/ScoreSubmit.sol",
  },
  {
    file: "infinite-spark-base-mainnet.json",
    identifier: "contracts/InfiniteSpark.sol:InfiniteSpark",
    sourceKey: "contracts/InfiniteSpark.sol",
  },
];

function postRequest(url, body, contentType) {
  return new Promise((resolve, reject) => {
    const data =
      typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function postJson(url, body) {
  return postRequest(url, body, "application/json");
}

function postForm(url, params) {
  return postRequest(
    url,
    params.toString(),
    "application/x-www-form-urlencoded"
  );
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error(`Invalid JSON: ${raw}`));
          }
        });
      })
      .on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findBuildInfo(sourceKey) {
  const buildInfoDir = path.resolve(__dirname, "../artifacts/build-info");
  if (!fs.existsSync(buildInfoDir)) {
    throw new Error("artifacts/build-info missing — run hardhat compile first");
  }
  const files = fs
    .readdirSync(buildInfoDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(buildInfoDir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const file of files) {
    const buildInfo = JSON.parse(fs.readFileSync(file, "utf8"));
    if (buildInfo.input?.sources?.[sourceKey]) {
      return buildInfo;
    }
  }
  throw new Error(`No build-info for ${sourceKey}`);
}

function encodeConstructorArgs(args) {
  if (!args || args.length === 0) return "";
  const { AbiCoder } = require("ethers");
  return AbiCoder.defaultAbiCoder()
    .encode(["address"], args)
    .replace(/^0x/, "");
}

async function verifyOnSourcify(job, deployment) {
  const buildInfo = findBuildInfo(job.sourceKey);
  const payload = {
    stdJsonInput: buildInfo.input,
    compilerVersion: buildInfo.solcLongVersion,
    contractIdentifier: job.identifier,
    creationTransactionHash: deployment.txHash,
  };

  const submit = await postJson(
    `https://sourcify.dev/server/v2/verify/${CHAIN_ID}/${deployment.address}`,
    payload
  );

  if (submit.status === 409 && submit.body?.customCode === "already_verified") {
    console.log("Already verified on Sourcify.");
    return true;
  }

  if (submit.status !== 200 && submit.status !== 202) {
    throw new Error(
      `Sourcify submit failed (${submit.status}): ${JSON.stringify(submit.body)}`
    );
  }

  const verificationId = submit.body.verificationId;
  if (!verificationId) {
    if (submit.body.error) throw new Error(`Sourcify error: ${submit.body.error}`);
    throw new Error(`Unexpected Sourcify response: ${JSON.stringify(submit.body)}`);
  }

  console.log("Sourcify job:", verificationId);
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const status = await getJson(
      `https://sourcify.dev/server/v2/verify/${verificationId}`
    );
    const match = status.contract?.match;
    console.log("Sourcify status:", status.status || match || status);
    if (match === "perfect" || match === "partial" || match === "exact_match") {
      console.log("Verified on Sourcify.");
      return true;
    }
    if (status.status === "failed") throw new Error(JSON.stringify(status));
  }
  throw new Error("Sourcify verification timed out");
}

async function verifyOnBasescan(job, deployment) {
  if (!apiKey) return false;

  const buildInfo = findBuildInfo(job.sourceKey);
  const compilerVersion = buildInfo.solcLongVersion.startsWith("v")
    ? buildInfo.solcLongVersion
    : `v${buildInfo.solcLongVersion}`;

  const constructorArgs = encodeConstructorArgs(deployment.constructorArgs || []);

  const params = new URLSearchParams({
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: deployment.address,
    sourceCode: JSON.stringify(buildInfo.input),
    codeformat: "solidity-standard-json-input",
    contractname: job.identifier,
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: constructorArgs,
  });

  // Must POST — GET hits 414 with standard-json source payloads.
  // chainid is a query param for Etherscan API V2.
  const submitRes = await postForm(
    `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`,
    params
  );
  const submit = submitRes.body;

  if (submit.status !== "1") {
    const msg = String(submit.result || submit.message || "");
    if (msg.toLowerCase().includes("already verified")) {
      console.log("Already verified on Basescan.");
      return true;
    }
    throw new Error(
      `Basescan submit failed: ${msg || JSON.stringify(submitRes)}`
    );
  }

  const guid = submit.result;
  console.log("Basescan GUID:", guid);

  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const status = await getJson(
      `https://api.etherscan.io/v2/api?` +
        new URLSearchParams({
          apikey: apiKey,
          chainid: String(CHAIN_ID),
          module: "contract",
          action: "checkverifystatus",
          guid,
        }).toString()
    );
    console.log("Basescan status:", status.result || status.message);
    if (status.status === "1") {
      console.log(
        "Verified on Basescan:",
        `https://basescan.org/address/${deployment.address}#code`
      );
      return true;
    }
    if (
      status.result &&
      !String(status.result).toLowerCase().includes("pending") &&
      String(status.result).toLowerCase().includes("fail")
    ) {
      throw new Error(status.result);
    }
  }
  throw new Error("Basescan verification timed out");
}

async function main() {
  for (const job of JOBS) {
    const deploymentPath = path.resolve(
      __dirname,
      "../../deployments",
      job.file
    );
    if (!fs.existsSync(deploymentPath)) {
      throw new Error(`Missing deployment file: ${job.file}`);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    console.log(`\n=== Verifying ${job.identifier} @ ${deployment.address} ===\n`);

    let basescanOk = false;
    if (apiKey) {
      try {
        basescanOk = await verifyOnBasescan(job, deployment);
      } catch (err) {
        console.warn("Basescan verify failed:", err.message || err);
      }
    } else {
      console.log("No ETHERSCAN_API_KEY — verifying via Sourcify only.");
    }

    if (!basescanOk) {
      await verifyOnSourcify(job, deployment);
    }

    const basescanUrl = `https://basescan.org/address/${deployment.address}#code`;
    const updated = {
      ...deployment,
      verified: true,
      verifiedAt: new Date().toISOString(),
      verification: {
        basescan: basescanUrl,
        sourcify: `https://repo.sourcify.dev/${CHAIN_ID}/${deployment.address}`,
      },
    };
    fs.writeFileSync(deploymentPath, JSON.stringify(updated, null, 2));
    console.log("Saved verification metadata.");
  }

  console.log("\nAll verifications finished.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
