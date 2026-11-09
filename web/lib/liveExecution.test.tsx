import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveExecution } from "./liveExecution";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(payload) });
    }
  }
}

function Probe() {
  const { marks, equity, live, connected } = useLiveExecution();
  return (
    <div>
      <span data-testid="mark">{marks["trade-1"]?.liquidationValueUsd ?? "-"}</span>
      <span data-testid="equity">{equity?.equityUsd ?? "-"}</span>
      <span data-testid="streaming">{String(live.streaming)}</span>
      <span data-testid="connected">{String(connected)}</span>
    </div>
  );
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("live execution marks", () => {
  it("applies snapshots, marks and equity from one shared SSE connection", () => {
    const view = render(<Probe />);
    const source = FakeEventSource.instances.at(-1)!;
    expect(source.url).toBe("/api/stream/execution");

    act(() => source.onopen?.());
    act(() =>
      source.emit("snapshot", {
        marks: {
          "trade-1": {
            tradeId: "trade-1",
            markedAt: "2026-11-09T15:30:00.000Z",
            liquidationValueUsd: 100,
            underlyingPrice: 101,
          },
        },
        equity: {
          asOf: "2026-11-09T15:30:00.000Z",
          cashUsd: 99_900,
          positionsUsd: 100,
          equityUsd: 100_000,
        },
        live: { streaming: true, source: "stream", lastMarkAt: "2026-11-09T15:30:00.000Z" },
      })
    );

    expect(screen.getByTestId("mark").textContent).toBe("100");
    expect(screen.getByTestId("equity").textContent).toBe("100000");
    expect(screen.getByTestId("streaming").textContent).toBe("true");
    expect(screen.getByTestId("connected").textContent).toBe("true");

    act(() =>
      source.emit("mark", {
        tradeId: "trade-1",
        markedAt: "2026-11-09T15:31:00.000Z",
        liquidationValueUsd: 140,
        underlyingPrice: 102,
      })
    );
    expect(screen.getByTestId("mark").textContent).toBe("140");

    act(() =>
      source.emit("equity", {
        asOf: "2026-11-09T15:31:00.000Z",
        cashUsd: 99_900,
        positionsUsd: 140,
        equityUsd: 100_040,
      })
    );
    expect(screen.getByTestId("equity").textContent).toBe("100040");

    view.unmount();
    expect(source.closed).toBe(true);
  });
});
