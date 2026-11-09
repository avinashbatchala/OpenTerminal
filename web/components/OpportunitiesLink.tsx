"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import type { ScannerNotification } from "../lib/scanner";
import { useTerminal } from "../store/terminal";

export default function OpportunitiesLink() {
  const { data = [] } = useQuery({
    queryKey: ["scanner", "notifications", "unread"],
    queryFn: () => apiGet<ScannerNotification[]>("/api/scanner/notifications?unread=true"),
    refetchInterval: 30_000,
    retry: 0,
  });
  const widgets = useTerminal((state) => state.widgets);
  const addWidget = useTerminal((state) => state.addWidget);
  const present = widgets.some((widget) => widget.type === "opportunities");

  return (
    <button
      type="button"
      onClick={() => {
        if (!present) addWidget("opportunities");
      }}
      className="relative flex items-center gap-1 border-0 bg-transparent p-0 text-[11px] text-[var(--text-dim)] hover:text-[var(--amber)] cursor-pointer"
      title={present ? "Opportunities widget is on the dashboard" : "Add the opportunities widget"}
    >
      <span className="hidden sm:inline">OPPORTUNITIES</span>
      <span className="sm:hidden">OPPS</span>
      {data.length > 0 && (
        <span
          aria-label={`${data.length} unread scanner notifications`}
          className="min-w-4 h-4 px-1 rounded-full bg-[var(--down)] text-black text-[9px] font-bold flex items-center justify-center"
        >
          {data.length > 99 ? "99+" : data.length}
        </span>
      )}
    </button>
  );
}
