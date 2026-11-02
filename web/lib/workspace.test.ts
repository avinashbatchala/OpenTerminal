import { describe, expect, it } from "vitest";
import type { LayoutItem, WidgetInstance } from "../store/terminal";
import { sanitizeWorkspace } from "./workspace";

describe("workspace migration", () => {
  it("removes the retired AI widget without touching other widgets", () => {
    const widgets = [
      { id: "w-quote", type: "quote", linked: true },
      { id: "w-ai", type: "ai", linked: false },
      { id: "w-chart", type: "chart", linked: true },
    ] as unknown as WidgetInstance[];
    const layout: LayoutItem[] = [
      { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
      { i: "w-ai", x: 0, y: 12, w: 5, h: 10 },
      { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
    ];

    const result = sanitizeWorkspace(widgets, layout);

    expect(result.widgets.map((widget) => widget.id)).toEqual(["w-quote", "w-chart"]);
    expect(result.layout).toEqual([
      { i: "w-quote", x: 7, y: 0, w: 5, h: 6 },
      { i: "w-chart", x: 0, y: 0, w: 7, h: 12 },
    ]);
  });

  it("keeps customized layouts when no AI widget exists", () => {
    const widgets = [{ id: "w-quote", type: "quote", linked: true }] as WidgetInstance[];
    const layout: LayoutItem[] = [{ i: "w-quote", x: 2, y: 4, w: 9, h: 8 }];

    expect(sanitizeWorkspace(widgets, layout)).toEqual({ widgets, layout });
  });
});
