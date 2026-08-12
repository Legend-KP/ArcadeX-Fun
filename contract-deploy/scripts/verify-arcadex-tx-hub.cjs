/**
 * Verify ArcadeXTxHub on Basescan (Etherscan V2) + Sourcify.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../../../arcadex-celo/.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DEPLOYMENT_FILE = path.resolve(
  __dirname,
  "../../deployments/arcadex-tx-hub-base-mainnet.json"
);
const CONTRACT_IDENTIFIER = "contracts/ArcadeXTxHub.sol:ArcadeXTxHub";
const CHAIN_ID = 8453;

const apiKey =
  process.env.ETHERSCAN_API_KEY || process.env.BASESCAN_API_KEY || "";

function postRequest(url, body, contentType) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
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
  return postRequest(url, params.toString(), "application/x-www-form-urlencoded");
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

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_FILE)) {
    throw new Error(`Deployment file not found: ${DEPLOYMENT_FILE}`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, "utf8"));
}

function findBuildInfo() {
  const buildInfoDir = path.resolve(__dirname, "../artifacts/build-info");
  const files = fs
    .readdirSync(buildInfoDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(buildInfoDir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  for (const file of files) {
    const buildInfo = JSON.parse(fs.readFileSync(file, "utf8"));
    if (buildInfo.input?.sources?.["contracts/ArcadeXTxHub.sol"]) {
      return buildInfo;
    }
  }

  throw new Error("No build-info artifact found for contracts/ArcadeXTxHub.sol");
}

async function verifyOnSourcify(address, txHash) {
  const buildInfo = findBuildInfo();
  const payload = {
    stdJsonInput: buildInfo.input,
    compilerVersion: buildInfo.solcLongVersion,
    contractIdentifier: CONTRACT_IDENTIFIER,
    creationTransactionHash: txHash,
  };

  const submit = await postJson(
    `https://sourcify.dev/server/v2/verify/${CHAIN_ID}/${address}`,
    payload
  );

  if (submit.status !== 200 && submit.status !== 202) {
    if (submit.status === 409 && submit.body?.customCode === "already_verified") {
      console.log("Already verified on Sourcify.");
      return true;
    }
    throw new Error(
      `Sourcify submit failed (${submit.status}): ${JSON.stringify(submit.body)}`
    );
  }

  const verificationId = submit.body.verificationId;
  if (!verificationId) {
    if (submit.body.error) {
      throw new Error(`Sourcify error: ${submit.body.error}`);
    }
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

    if (status.status === "failed") {
      throw new Error(JSON.stringify(status));
    }
  }

  throw new Error("Sourcify verification timed out");
}

async function verifyOnBasescan(address) {
  if (!apiKey) {
    return false;
  }

  const buildInfo = findBuildInfo();
  const compilerVersion = buildInfo.solcLongVersion.startsWith("v")
    ? buildInfo.solcLongVersion
    : `v${buildInfo.solcLongVersion}`;

  const params = new URLSearchParams({
    apikey: apiKey,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: JSON.stringify(buildInfo.input),
    codeformat: "solidity-standard-json-input",
    contractname: CONTRACT_IDENTIFIER,
    compilerversion: compilerVersion,
    optimizationUsed: "1",
    runs: "200",
    constructorArguements: "",
  });

  // chainid must be a query param for Etherscan API V2.
  const submit = await postForm(
    `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}`,
    params
  );

  const body = submit.body;
  if (!body || body.status !== "1") {
    const msg = body?.result || body?.message || JSON.stringify(body);
    if (String(msg).toLowerCase().includes("already verified")) {
      console.log("Already verified on Basescan.");
      return true;
    }
    throw new Error(`Basescan submit failed: ${msg}`);
  }

  const guid = body.result;
  console.log("Basescan GUID:", guid);

  for (let i = 0; i < 20; i++) {
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
        `https://basescan.org/address/${address}#code`
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

async function checkBasescanVerified(address) {
  const res = await getJson(
    `https://api.etherscan.io/v2/api?` +
      new URLSearchParams({
        chainid: String(CHAIN_ID),
        module: "contract",
        action: "getabi",
        address,
        ...(apiKey ? { apikey: apiKey } : {}),
      }).toString()
  );

  return (
    res.status === "1" &&
    res.result &&
    res.result !== "Contract source code not verified"
  );
}

function saveVerification(deployment, basescanUrl) {
  const updated = {
    ...deployment,
    verified: true,
    verifiedAt: new Date().toISOString(),
    verification: {
      basescan: basescanUrl,
      sourcify: `https://repo.sourcify.dev/${CHAIN_ID}/${deployment.address}`,
    },
  };
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(updated, null, 2));
}

async function main() {
  const deployment = loadDeployment();
  const { address, txHash } = deployment;

  if (!address || !txHash) {
    throw new Error("Deployment file must include address and txHash");
  }

  console.log("Verifying ArcadeXTxHub at", address);

  const basescanUrl = `https://basescan.org/address/${address}#code`;

  if (await checkBasescanVerified(address)) {
    console.log("Already verified on Basescan:", basescanUrl);
    saveVerification(deployment, basescanUrl);
    return;
  }

  let basescanOk = false;
  if (apiKey) {
    try {
      basescanOk = await verifyOnBasescan(address);
    } catch (err) {
      console.warn("Basescan verify error:", err.message || err);
    }
  } else {
    console.log("No ETHERSCAN/BASESCAN API key — trying Sourcify first.");
  }

  if (!basescanOk) {
    await verifyOnSourcify(address, txHash);
    if (apiKey) {
      basescanOk = await verifyOnBasescan(address).catch((err) => {
        console.warn("Basescan retry error:", err.message || err);
        return false;
      });
    }
  }

  saveVerification(deployment, basescanUrl);
  console.log("Verification metadata saved.");
  console.log(basescanUrl);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
