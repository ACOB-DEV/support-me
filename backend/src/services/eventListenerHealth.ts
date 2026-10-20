/**
 * Tracks the Soroban event listener's cursor-recovery state in-process so
 * `GET /health` can report an out-of-retention gap (#268) instead of it
 * only ever showing up in logs. Mirrors executorHealth.ts: the listener
 * writes here, the health route only reads.
 */

export interface EventListenerHealthReport {
  /** Last-known position, mirrored from the DB-persisted checkpoint. */
  lastCursor: string | null;
  /**
   * Set when the stored cursor was rejected by the RPC as outside the
   * node's retention window and the listener had to restart from the
   * oldest retained ledger — events between the old cursor and that
   * ledger were never seen and never will be.
   */
  gapDetected: boolean;
  gapDetectedAt: string | null;
  /** The ledger the listener actually resumed from after the gap. */
  recoveredFromLedger: number | null;
}

class EventListenerHealthTracker {
  private lastCursor: string | null = null;
  private gapDetectedAt: string | null = null;
  private recoveredFromLedger: number | null = null;

  setCursor(cursor: string | null): void {
    this.lastCursor = cursor;
  }

  /** Records that the stored cursor was outside retention and recovery ran. */
  recordGap(recoveredFromLedger: number, at = new Date()): void {
    this.gapDetectedAt = at.toISOString();
    this.recoveredFromLedger = recoveredFromLedger;
  }

  /** Clears the gap flag — called once an operator acknowledges it, or on full reset. */
  clearGap(): void {
    this.gapDetectedAt = null;
    this.recoveredFromLedger = null;
  }

  reset(): void {
    this.lastCursor = null;
    this.clearGap();
  }

  getHealth(): EventListenerHealthReport {
    return {
      lastCursor: this.lastCursor,
      gapDetected: this.gapDetectedAt !== null,
      gapDetectedAt: this.gapDetectedAt,
      recoveredFromLedger: this.recoveredFromLedger,
    };
  }
}

export const eventListenerHealth = new EventListenerHealthTracker();
