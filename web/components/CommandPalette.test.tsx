import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { useTerminal } from "../store/terminal";
import CommandPalette from "./CommandPalette";

beforeEach(() => {
  useTerminal.setState({ activeSymbol: "AAPL", commandOpen: false });
});

describe("command palette focus restoration", () => {
  it("returns focus to the element that opened it", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <CommandPalette />
      </QueryClientProvider>
    );

    const opener = document.createElement("button");
    opener.textContent = "opener";
    document.body.appendChild(opener);
    opener.focus();

    act(() => useTerminal.setState({ commandOpen: true }));
    const input = await screen.findByPlaceholderText(/Ticker, company/);
    await waitFor(() => expect(input).toHaveFocus());

    act(() => useTerminal.setState({ commandOpen: false }));
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
