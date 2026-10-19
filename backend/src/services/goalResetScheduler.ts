import { resetDueGoals } from "./goalService";
import * as Sentry from "@sentry/node";

const CHECK_INTERVAL_MS = Number(process.env.GOAL_RESET_CHECK_INTERVAL_MS) || 60 * 60 * 1000; // hourly

/**
 * Periodically resets recurring goals whose current period has ended,
 * mirroring `SubscriptionExecutor`'s and `SorobanEventListener`'s
 * start()/stop()/setInterval() shape.
 *
 * Limitations (deliberately simple, documented per the issue's own request
 * "not using a distributed cron system in a single backend that may not
 * always be running"):
 *   - This is a single-process `setInterval`, not a distributed job queue.
 *     If more than one backend instance runs concurrently, each one ticks
 *     independently; `resetDueGoals` is idempotent per goal (it only resets
 *     goals whose `currentPeriodEnd` has actually passed, and resetting sets
 *     a new future `currentPeriodEnd`), so a duplicate tick from a second
 *     instance is a harmless no-op rather than a double reset — but nothing
 *     here coordinates leadership across instances.
 *   - If the backend process is down when a goal's period technically ends,
 *     the reset simply happens late, on the first tick after the process
 *     next starts (or the next scheduled tick) — there's no catch-up backlog
 *     tracking beyond "was currentPeriodEnd in the past when we checked".
 *     For a monthly/weekly cadence this is an acceptable approximation
 *     rather than a hard guarantee of firing at the exact instant.
 *   - The check interval (default hourly, `GOAL_RESET_CHECK_INTERVAL_MS`)
 *     trades timing precision for simplicity: a goal can reset up to one
 *     interval late. Given resets happen on a weekly/monthly cadence, being
 *     off by up to an hour is not significant in practice.
 */
export class GoalResetScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      void this.tick();
    }, CHECK_INTERVAL_MS);
    void this.tick();
    console.log(`GoalResetScheduler: checking for due recurring goals every ${CHECK_INTERVAL_MS}ms`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Runs one pass over every due recurring goal. Public so tests can drive it. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const resetCount = await resetDueGoals();
      if (resetCount > 0) {
        console.log(`GoalResetScheduler: reset ${resetCount} recurring goal(s)`);
      }
    } catch (error) {
      console.error("GoalResetScheduler: tick failed:", (error as Error).message);
      Sentry.captureException(error, {
        tags: { component: "GoalResetScheduler" },
      });
    } finally {
      this.running = false;
    }
  }
}

export const goalResetScheduler = new GoalResetScheduler();
