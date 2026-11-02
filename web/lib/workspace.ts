import type { LayoutItem, WidgetInstance } from "../store/terminal";

/**
 * Drop the retired AI widget from persisted workspaces without resetting any
 * other widgets or layout customization.
 */
export function sanitizeWorkspace(
  widgets: WidgetInstance[],
  layout: LayoutItem[]
): { widgets: WidgetInstance[]; layout: LayoutItem[] } {
  const kept = widgets.filter((widget) => (widget.type as string) !== "ai");
  const ids = new Set(kept.map((widget) => widget.id));
  return { widgets: kept, layout: layout.filter((item) => ids.has(item.i)) };
}
