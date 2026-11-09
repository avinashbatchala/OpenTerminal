import { describe, expect, it, vi } from "vitest";
import { defaultExecutionConfig } from "./config.js";
import { ExecutionScheduler } from "./scheduler.js";

function harness(enabled: boolean) {
  const config = { ...defaultExecutionConfig(), enabled };
  const engine = {
    automate: vi.fn(async () => ({ status: "completed" as const })),
    recover: vi.fn(() => 0),
  };
  const store = { getConfig: () => config };
  const scheduler = new ExecutionScheduler(
    engine as never,
    store as never,
    30_000,
    () => new Date("2026-11-09T15:00:00.000Z")
  );
  return { engine, scheduler };
}

describe("execution scheduler", () => {
  it("runs an automation pass during the regular session", async () => {
    const { engine, scheduler } = harness(true);
    await scheduler.tick(new Date("2026-11-09T15:00:00.000Z"));
    expect(engine.automate).toHaveBeenCalledTimes(1);
  });

  it("stays idle when automation is disabled", async () => {
    const { engine, scheduler } = harness(false);
    await scheduler.tick(new Date("2026-11-09T15:00:00.000Z"));
    expect(engine.automate).not.toHaveBeenCalled();
  });

  it("stays idle outside the regular session", async () => {
    const { engine, scheduler } = harness(true);
    // Saturday
    await scheduler.tick(new Date("2026-11-07T15:00:00.000Z"));
    expect(engine.automate).not.toHaveBeenCalled();
  });
});
