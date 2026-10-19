import * as Sentry from "@sentry/node";
import prisma from "../prisma";
import { config } from "../config";
import { log } from "../lib/logger";
import { callSorobanRpc } from "./sorobanRpc";
import { contractInstanceExists } from "./sorobanContracts";

/**
 * Testnet-reset detection (#278).
 *
 * The public Stellar testnet is periodically wiped and restarted from a low
 * ledger sequence, which silently invalidates everything the backend believes
 * about on-chain state: contract IDs stop existing, subscription IDs restart
 * from 1, and every cached account sequence is stale. Before this existed the
 * executor kept retrying charges against contracts that no longer existed,
 * burning failure counts and emailing supporters about "failed" payments for
 * subscriptions that had simply ceased to be.
 *
 * Two independent signals, either of which means "the chain we knew is gone":
 *   1. The latest ledger sequence is lower than the last one we observed
 *      (sequences only ever move forward within a network's lifetime).
 *   2. The donation contract's instance entry no longer exists on-chain.
 *
 * On detection the detector is sticky: it pauses the executor and event
 * listener through registered callbacks, reports to Sentry, and /health
 * reports `network: "reset_detected"` until an operator runs the resync
 * runbook (POST /api/admin/network-resync after redeploying contracts).
 */

export type NetworkStatus = "ok" | "reset_detected";

export interface NetworkResetState {
  status: NetworkStatus;
  reason: string | null;
  detectedAt: string | null;
  lastSeenLedger: number | null;
  latestLedger: number | null;
}

/** DB row key for the last-seen ledger checkpoint. */
export const LAST_SEEN_LEDGER_KEY = "soroban:lastSeenLedger";

const INITIAL_STATE: NetworkResetState = {
  status: "ok",
  reason: null,
  detectedAt: null,
  lastSeenLedger: null,
  latestLedger: null,
};

type PauseCallback = () => void;

class NetworkResetDetector {
  private state: NetworkResetState = { ...INITIAL_STATE };
  private pauseCallbacks: PauseCallback[] = [];
  private checking = false;

  /** Registers a callback fired once when a reset is first detected. */
  onPause(callback: PauseCallback): void {
    this.pauseCallbacks.push(callback);
  }

  getState(): NetworkResetState {
    return { ...this.state };
  }

  /**
   * Runs one detection pass. Returns true when a reset has been detected
   * (including from an earlier pass). Safe to call from several pollers: an
   * in-flight check short-circuits concurrent callers, and RPC failure is
   * inconclusive rather than evidence of a reset.
   */
  async check(): Promise<boolean> {
    if (this.state.status === "reset_detected") return true;
    if (this.checking) return false;
    this.checking = true;

    try {
      const { sequence } = await callSorobanRpc<{ sequence: number }>(
        "getLatestLedger",
        {},
        { retries: 1 }
      );

      const stored = await this.readCheckpoint();
      if (stored != null && sequence < stored) {
        this.markResetDetected(
          `latest ledger ${sequence} is lower than the last seen ledger ${stored} — the Stellar network was reset`
        );
        return true;
      }

      // Signal 2: the donation contract instance must still exist. A thrown
      // probe (RPC outage) is inconclusive and skipped, never a reset.
      const donationContractId = config.donationContractId;
      if (donationContractId) {
        let exists: boolean;
        try {
          exists = await contractInstanceExists(donationContractId);
        } catch (error) {
          log("warn", "Network reset contract probe failed", {
            error: (error as Error).message,
          });
          exists = true; // inconclusive: do not treat as missing
        }
        if (!exists) {
          this.markResetDetected(
            `donation contract ${donationContractId} no longer exists on-chain — ` +
              "the network was reset or the deployment is on the wrong network"
          );
          return true;
        }
      }

      // Healthy: advance the checkpoint so the next backwards jump is caught.
      await this.writeCheckpoint(Math.max(stored ?? 0, sequence));
      this.state = {
        ...this.state,
        status: "ok",
        lastSeenLedger: sequence,
        latestLedger: sequence,
      };
      return false;
    } catch (error) {
      log("warn", "Network reset check failed", {
        error: (error as Error).message,
      });
      return false;
    } finally {
      this.checking = false;
    }
  }

  private async readCheckpoint(): Promise<number | null> {
    const row = await prisma.networkCheckpoint.findUnique({
      where: { key: LAST_SEEN_LEDGER_KEY },
    });
    const value = row ? Number(row.value) : NaN;
    return Number.isFinite(value) ? value : null;
  }

  private async writeCheckpoint(sequence: number): Promise<void> {
    await prisma.networkCheckpoint.upsert({
      where: { key: LAST_SEEN_LEDGER_KEY },
      update: { value: String(sequence) },
      create: { key: LAST_SEEN_LEDGER_KEY, value: String(sequence) },
    });
  }

  markResetDetected(reason: string): void {
    if (this.state.status === "reset_detected") return;

    this.state = {
      status: "reset_detected",
      reason,
      detectedAt: new Date().toISOString(),
      lastSeenLedger: this.state.lastSeenLedger,
      latestLedger: this.state.latestLedger,
    };

    log("error", "Stellar network reset detected — pausing executor and event listener", {
      reason,
    });
    Sentry.captureMessage(`Stellar network reset detected: ${reason}`, "fatal");

    for (const callback of this.pauseCallbacks) {
      try {
        callback();
      } catch (error) {
        log("error", "Network reset pause callback failed", {
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Clears detection state and the stored checkpoint after an operator has
   * redeployed the contracts and run the resync (see docs/testnet-
   * troubleshooting.md). Called by POST /api/admin/network-resync.
   */
  async clearAfterResync(): Promise<void> {
    await prisma.networkCheckpoint.deleteMany({
      where: { key: LAST_SEEN_LEDGER_KEY },
    });
    this.state = { ...INITIAL_STATE };
    log("info", "Network reset state cleared after resync");
  }

  /** Test-only: restore pristine in-process state. */
  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.pauseCallbacks = [];
    this.checking = false;
  }
}

export const networkReset = new NetworkResetDetector();
