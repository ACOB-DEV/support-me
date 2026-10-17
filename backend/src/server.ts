import app from "./app";
import { assertRequiredEnv, validateConfig } from "./config";
import { sorobanEventListener } from "./services/sorobanEventListener";
import { subscriptionExecutor } from "./services/subscriptionExecutor";
import { goalResetScheduler } from "./services/goalResetScheduler";
import { validateStellarNetworkSetup } from "./services/startupValidation";
import { networkReset } from "./services/networkReset";
import { log } from "./lib/logger";

async function main(): Promise<void> {
  validateConfig();

  // #281: before serving traffic, verify that every configured RPC endpoint,
  // contract ID and the executor key agree with the configured Stellar
  // network. A mismatch fails startup in production instead of running
  // against the wrong chain.
  await validateStellarNetworkSetup();

  // #278: a testnet reset invalidates all cached on-chain state. Register the
  // pause first, then check once at boot so a backend started after a reset
  // doesn't begin charging against the dead network.
  networkReset.onPause(() => {
    sorobanEventListener.stop();
    subscriptionExecutor.stop();
  });
  await networkReset.check();

  const port = process.env.PORT ?? 4000;

  // Fail before binding a port if a required secret is missing, so a
  // misconfigured deployment never serves traffic with a weak or absent
  // signing key (#178).
  assertRequiredEnv();

  app.listen(port, () => {
    console.log(`SupportMe backend listening on http://localhost:${port}`);
    goalResetScheduler.start();

    // Don't start charging against a network already known to be reset at
    // boot; the resync runbook restarts these once the deployment is fixed.
    if (networkReset.getState().status === "reset_detected") {
      log("error", "Background workers not started: network reset detected", {
        runbook: "docs/testnet-troubleshooting.md",
      });
      return;
    }

    sorobanEventListener.start();
    subscriptionExecutor.start();
  });
}

void main().catch((error) => {
  log("error", "Fatal startup error", { error: (error as Error).message });
  process.exit(1);
});
