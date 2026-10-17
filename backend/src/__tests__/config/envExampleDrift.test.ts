import { spawnSync } from "child_process";
import path from "path";

/**
 * Runs scripts/check-env-example-drift.js (#302) as a real CI-shaped
 * assertion rather than re-implementing its dotenv parsing here -- the
 * script is the single source of truth, and this test just gives it a
 * `npm test` surface so a drift fails locally too, not only in CI.
 */
describe("frontend/backend .env.example contract ID drift (#302)", () => {
  it("keeps frontend's NEXT_PUBLIC_DONATION_CONTRACT_ID and backend's DONATION_CONTRACT_ID in sync", () => {
    const scriptPath = path.resolve(__dirname, "../../../../scripts/check-env-example-drift.js");
    const result = spawnSync(process.execPath, [scriptPath], { encoding: "utf8" });

    if (result.status !== 0) {
      throw new Error(`check-env-example-drift.js failed:\n${result.stdout}${result.stderr}`);
    }
    expect(result.status).toBe(0);
  });
});
