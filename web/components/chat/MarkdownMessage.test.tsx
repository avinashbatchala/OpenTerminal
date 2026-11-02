import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import MarkdownMessage from "./MarkdownMessage";

describe("Markdown strategy tables", () => {
  it("renders accessible headers and a horizontally scrollable table region", () => {
    render(
      <MarkdownMessage
        content={`| Strategy | Leg | Symbol | Expiry | Call/Put | Strike | Buy/Sell | Quantity/Ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Bull call spread | Long | AAPL | 2026-11-20 | Call | 230 | Buy | 1 |`}
      />
    );

    const region = screen.getByRole("region", { name: "Data table" });
    expect(region).toHaveClass("overflow-x-auto");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table")).toBeInTheDocument();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
    expect(screen.getByText("Bull call spread")).toBeInTheDocument();
  });
});
