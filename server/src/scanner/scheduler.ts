import { scannerReadiness } from "./config.js";
import { sessionState } from "./calendar.js";
import { ScannerEngine, nextScheduledAt } from "./engine.js";
import type { ScannerStore } from "./store.js";

export class ScannerScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private gapRecordedForRun: number | null = null;

  constructor(
    private readonly engine: ScannerEngine,
    private readonly store: ScannerStore,
    private readonly intervalMs = 30_000
  ) {}

  start(): void {
    if (this.timer) return;
    const recovered = this.engine.recoverAfterRestart();
    if (recovered.interrupted || recovered.expired) {
      console.warn(
        `[scanner] recovery: ${recovered.interrupted} interrupted run(s), ${recovered.expired} expired setup(s)`
      );
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

  async tick(now = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.engine.expireDeadlines(now);
      const config = this.store.getConfig();
      if (!config.enabled || !scannerReadiness(config).ready) return;
      if (sessionState(now).state !== "open") return;
      const last = this.store.lastCompletedRun();
      const next = nextScheduledAt(config, last, now);
      if (next && Date.parse(next) > now.getTime()) {
        // Between discovery scans, run the cheap quote pass so entries,
        // misses and invalidations are noticed within the tick cadence.
        await this.engine.runMonitoring(now);
        return;
      }
      if (last && this.gapRecordedForRun !== last.id) {
        const interval = config.scanIntervalMinutes * 60_000;
        const expected = Date.parse(last.startedAt) + interval;
        if (now.getTime() - expected > interval) {
          this.store.recordMonitoringGap(
            new Date(expected).toISOString(),
            now.toISOString(),
            "Scanning gap detected after the API process was idle or asleep; no missed market events were replayed"
          );
          this.gapRecordedForRun = last.id;
        }
      }
      await this.engine.runScan("scheduled");
    } catch (error) {
      console.warn(
        `[scanner] scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
    }
  }
}
