#!/usr/bin/env node
/**
 * Asserts that frontend/.env.example and backend/.env.example never drift on
 * the Soroban contract IDs they share (#302). The two files intentionally use
 * differently-named variables for the same value -- the frontend's
 * NEXT_PUBLIC_DONATION_CONTRACT_ID is a client-bundled Next.js variable, and
 * the backend's DONATION_CONTRACT_ID is deliberately unprefixed because
 * NEXT_PUBLIC_ means nothing server-side -- so a plain text diff of the two
 * files can't catch a mismatch; this reads each file's own variable name and
 * compares the values directly.
 *
 * Run directly (`node scripts/check-env-example-drift.js`) or via
 * `npm run check:env-drift` from the repo root. Exits non-zero and prints a
 * diagnostic on drift, so it is safe to wire into CI as its own step.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");

// Each pair shares one logical value but is named differently per package
// convention (frontend vars are NEXT_PUBLIC_-prefixed; backend vars are not).
const CHECKS = [
  {
    label: "donation contract ID",
    frontendFile: "frontend/.env.example",
    frontendVar: "NEXT_PUBLIC_DONATION_CONTRACT_ID",
    backendFile: "backend/.env.example",
    backendVar: "DONATION_CONTRACT_ID",
  },
];

/**
 * Extracts VAR=value from a dotenv-style file, ignoring commented-out lines
 * (a leading `#`) and blank lines. Only the first uncommented assignment for
 * a given name is used, matching how dotenv-style loaders resolve duplicates.
 * Strips surrounding single/double quotes, which both .env.example files use
 * inconsistently.
 */
function readEnvVar(relativeFilePath, varName) {
  const absolutePath = path.join(REPO_ROOT, relativeFilePath);
  const contents = fs.readFileSync(absolutePath, "utf8");

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (name !== varName) continue;

    return rawValue.trim().replace(/^["']|["']$/g, "");
  }

  return undefined;
}

function main() {
  const failures = [];

  for (const check of CHECKS) {
    const frontendValue = readEnvVar(check.frontendFile, check.frontendVar);
    const backendValue = readEnvVar(check.backendFile, check.backendVar);

    if (!frontendValue) {
      failures.push(
        `${check.frontendFile}: ${check.frontendVar} is missing or commented out (expected an active, uncommented value).`
      );
      continue;
    }
    if (!backendValue) {
      failures.push(
        `${check.backendFile}: ${check.backendVar} is missing or commented out (expected an active, uncommented value).`
      );
      continue;
    }
    if (frontendValue !== backendValue) {
      failures.push(
        `${check.label} mismatch:\n` +
          `  ${check.frontendFile} ${check.frontendVar}=${frontendValue}\n` +
          `  ${check.backendFile} ${check.backendVar}=${backendValue}\n` +
          `  Update whichever one is stale so both packages point at the same deployed contract.`
      );
    }
  }

  if (failures.length > 0) {
    console.error("Env example drift detected:\n");
    for (const failure of failures) console.error(`- ${failure}\n`);
    process.exit(1);
  }

  console.log("OK: frontend/.env.example and backend/.env.example agree on shared contract IDs.");
}

main();
