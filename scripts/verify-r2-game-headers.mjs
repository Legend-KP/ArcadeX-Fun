#!/usr/bin/env node
/**
 * Verify Unity WebGL assets on an R2 custom domain:
 *  - Content-Type / Content-Encoding for Brotli builds
 *  - Cache-Control
 *  - CF-Cache-Status HIT on a repeated request
 *
 * Usage:
 *   node scripts/verify-r2-game-headers.mjs https://games.example.com/basedrop
 *   node scripts/verify-r2-game-headers.mjs https://games.example.com/basedrop/Build/basedrop.wasm.br
 */

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error(
    "Usage: node scripts/verify-r2-game-headers.mjs <asset-or-build-base-url>"
  );
  process.exit(1);
}

const input = args[0].replace(/\/$/, "");

/** @type {{ path: string; expectType?: RegExp; expectEncoding?: string; immutable?: boolean }[]} */
const DEFAULT_ASSETS = [
  { path: "/index.html", expectType: /text\/html/i, immutable: false },
  {
    path: "/Build/",
    // Placeholder — caller should pass concrete files for Build/*
  },
];

function guessChecks(url) {
  const lower = url.toLowerCase();
  /** @type {{ expectType?: RegExp; expectEncoding?: string; immutable?: boolean }} */
  const check = { immutable: true };

  if (lower.endsWith(".wasm") || lower.endsWith(".wasm.br")) {
    check.expectType = /application\/wasm|application\/octet-stream/i;
  } else if (lower.includes(".framework.js") || lower.endsWith(".js") || lower.endsWith(".js.br")) {
    check.expectType = /javascript|ecmascript/i;
  } else if (lower.endsWith(".data") || lower.endsWith(".data.br")) {
    check.expectType = /octet-stream|application\/octet-stream/i;
  } else if (lower.endsWith(".json") || lower.endsWith(".json.br")) {
    check.expectType = /json/i;
  } else if (lower.endsWith("index.html") || lower.endsWith(".html")) {
    check.expectType = /html/i;
    check.immutable = false;
  }

  if (lower.endsWith(".br")) {
    check.expectEncoding = "br";
  } else if (lower.endsWith(".gz")) {
    check.expectEncoding = "gzip";
  }

  return check;
}

async function probe(url) {
  const check = guessChecks(url);
  const first = await fetch(url, { method: "GET", redirect: "follow" });
  // Drain body so connection can be reused / cache populated.
  await first.arrayBuffer().catch(() => {});

  const second = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "Cache-Control": "no-cache" },
  });
  await second.arrayBuffer().catch(() => {});

  const headers = second.headers;
  const contentType = headers.get("content-type") ?? "";
  const contentEncoding = headers.get("content-encoding") ?? "";
  const cacheControl = headers.get("cache-control") ?? "";
  const cfStatus = headers.get("cf-cache-status") ?? "(missing)";
  const age = headers.get("age") ?? "";

  const problems = [];

  if (check.expectType && !check.expectType.test(contentType)) {
    problems.push(`Content-Type="${contentType}" (expected ${check.expectType})`);
  }
  if (check.expectEncoding) {
    if (contentEncoding.toLowerCase() !== check.expectEncoding) {
      problems.push(
        `Content-Encoding="${contentEncoding}" (expected ${check.expectEncoding})`
      );
    }
  }
  if (check.immutable === false) {
    if (/max-age=31536000/i.test(cacheControl) || /immutable/i.test(cacheControl)) {
      problems.push(
        `Cache-Control="${cacheControl}" looks too long for mutable HTML/loader`
      );
    }
  } else if (check.immutable === true && !/index\.html/i.test(url)) {
    if (!/max-age=\d+/i.test(cacheControl) && !/s-maxage=\d+/i.test(cacheControl)) {
      problems.push(`Cache-Control="${cacheControl}" missing max-age for versioned asset`);
    }
  }

  if (cfStatus !== "HIT" && cfStatus !== "EXPIRED" && cfStatus !== "STALE") {
    // First miss is OK; warn if still MISS/DYNAMIC/BYPASS on second request.
    if (cfStatus === "MISS" || cfStatus === "DYNAMIC" || cfStatus === "BYPASS" || cfStatus === "(missing)") {
      problems.push(`CF-Cache-Status=${cfStatus} on second request (want HIT)`);
    }
  }

  return {
    url,
    status: second.status,
    contentType,
    contentEncoding,
    cacheControl,
    cfStatus,
    age,
    firstCf: first.headers.get("cf-cache-status") ?? "(missing)",
    ok: second.ok && problems.length === 0,
    problems,
  };
}

function expandTargets(base) {
  if (/\.(js|wasm|data|json|html)(\.br|\.gz)?$/i.test(base)) {
    return [base];
  }
  // Treat as build folder root — probe common Unity names if present via HEAD list is not available;
  // probe index.html and ask user to pass Build files for full coverage.
  return [`${base}/index.html`];
}

async function main() {
  const targets = expandTargets(input);
  let failed = 0;

  for (const url of targets) {
    const result = await probe(url);
    const mark = result.ok ? "OK" : "FAIL";
    console.log(`\n[${mark}] ${result.url}`);
    console.log(`  status=${result.status}`);
    console.log(`  Content-Type=${result.contentType}`);
    console.log(`  Content-Encoding=${result.contentEncoding || "(none)"}`);
    console.log(`  Cache-Control=${result.cacheControl || "(none)"}`);
    console.log(`  CF-Cache-Status first=${result.firstCf} second=${result.cfStatus} age=${result.age || "-"}`);
    for (const p of result.problems) {
      console.log(`  ! ${p}`);
    }
    if (!result.ok) failed += 1;
  }

  if (targets.length === 1 && /index\.html$/i.test(targets[0])) {
    console.log(
      "\nTip: also probe Build/*.wasm.br, *.framework.js.br, *.data.br, *.loader.js for full Unity header coverage."
    );
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
