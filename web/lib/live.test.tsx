import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveQuotes } from "./live";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
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

function Probe({ symbols, label }: { symbols: string[]; label: string }) {
  const { quotes, connected } = useLiveQuotes(symbols);
  return (
    <div>
      <span data-testid={`${label}-price`}>{quotes[symbols[0]]?.price ?? "-"}</span>
      <span data-testid={`${label}-connected`}>{String(connected)}</span>
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

describe("shared live quote stream", () => {
  it("opens one SSE connection for the union of subscribers and fans out frames", () => {
    render(
      <>
        <Probe symbols={["AAPL"]} label="quote" />
        <Probe symbols={["AAPL", "MSFT"]} label="watchlist" />
      </>
    );

    const active = FakeEventSource.instances.filter((instance) => !instance.closed);
    expect(active).toHaveLength(1);
    expect(active[0].url).toBe("/api/stream/quotes?symbols=AAPL%2CMSFT");

    const source = active[0];
    act(() => source.emit("status", { connected: true }));
    act(() => source.emit("quote", { symbol: "AAPL", price: 123.45 }));

    expect(screen.getByTestId("quote-price").textContent).toBe("123.45");
    expect(screen.getByTestId("watchlist-price").textContent).toBe("123.45");
    expect(screen.getByTestId("quote-connected").textContent).toBe("true");
    expect(screen.getByTestId("watchlist-connected").textContent).toBe("true");
  });

  it("keeps the shared connection when one subscriber unmounts", () => {
    const first = render(<Probe symbols={["AAPL"]} label="quote" />);
    const second = render(<Probe symbols={["AAPL", "MSFT"]} label="watchlist" />);

    const active = () => FakeEventSource.instances.filter((instance) => !instance.closed);
    expect(active()).toHaveLength(1);

    second.unmount();
    expect(active()).toHaveLength(1);

    first.unmount();
    expect(active()).toHaveLength(0);
  });

  it("replays the latest quotes to a subscriber that joins later", () => {
    const first = render(<Probe symbols={["AAPL"]} label="quote" />);
    const source = FakeEventSource.instances.at(-1)!;
    act(() => source.emit("status", { connected: true }));
    act(() => source.emit("quote", { symbol: "AAPL", price: 200 }));

    render(<Probe symbols={["AAPL", "MSFT"]} label="watchlist" />);

    expect(screen.getByTestId("watchlist-price").textContent).toBe("200");
    expect(FakeEventSource.instances.filter((instance) => !instance.closed)).toHaveLength(1);
    first.unmount();
  });
});
