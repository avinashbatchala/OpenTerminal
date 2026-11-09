import { sessionState } from "../scanner/calendar.js";
import type { ExecutionEngine } from "./engine.js";
import type { ExecutionStore } from "./store.js";

/**
 * Drives `ExecutionEngine.automate()` during regular sessions. The engine owns
 * the lease and all decisions; this scheduler only owns cadence and session
 * eligibility.
 */
export class ExecutionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly engine: ExecutionEngine,
    private readonly store: ExecutionStore,
    private readonly intervalMs = 30_000,
    private readonly now: () => Date = () => new Date()
  ) {}

  start(): void {
    if (this.timer) return;
    const recovered = this.engine.recover(this.now());
    if (recovered > 0) {
      console.warn(`[execution] recovery: cancelled ${recovered} pending paper trade(s)`);
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = this.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const config = this.store.getConfig();
      if (!config.enabled) return;
      if (sessionState(now).state !== "open") return;
      await this.engine.automate(now);
    } catch (error) {
      console.warn(
        `[execution] scheduler tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.running = false;
    }
  }
}
