"use client";

import { useEffect, useState } from "react";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import Workspace from "./Workspace";
import ScannerWatchlistSync from "./scanner/ScannerWatchlistSync";
import CommandPalette from "./CommandPalette";
import { ChatProvider } from "./chat/ChatProvider";
import ChatLauncher from "./chat/ChatLauncher";
import WidgetErrorBoundary from "./WidgetErrorBoundary";
import { useTerminal } from "../store/terminal";

export default function Terminal() {
  return (
    <ChatProvider>
      <TerminalContent />
    </ChatProvider>
  );
}

function TerminalContent() {
  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const addWidget = useTerminal((s) => s.addWidget);
  const [mobileWidgetsOpen, setMobileWidgetsOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (e.altKey) {
        const map: Record<string, () => void> = {
          "1": () => addWidget("chart"),
          "2": () => addWidget("quote"),
          "3": () => addWidget("news"),
          "4": () => addWidget("screener"),
          "5": () => addWidget("heatmap"),
          "6": () => addWidget("crypto"),
          "7": () => addWidget("options"),
          "8": () => addWidget("portfolio"),
          "9": () => addWidget("opportunities"),
          "0": () => addWidget("paper"),
        };
        const fn = map[e.key];
        if (fn) {
          e.preventDefault();
          fn();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen, addWidget]);

  useEffect(() => {
    if (!mobileWidgetsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileWidgetsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileWidgetsOpen]);

  return (
    <div className="flex flex-col h-screen">
      <TopBar onOpenWidgets={() => setMobileWidgetsOpen(true)} />
      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar
          mobileOpen={mobileWidgetsOpen}
          onClose={() => setMobileWidgetsOpen(false)}
        />
        {mobileWidgetsOpen && (
          <button
            type="button"
            className="sidebar-backdrop"
            aria-label="Close widget menu"
            onClick={() => setMobileWidgetsOpen(false)}
          />
        )}
        <main className="flex-1 overflow-auto">
          <ScannerWatchlistSync />
          <Workspace />
        </main>
      </div>
      <CommandPalette />
      <WidgetErrorBoundary name="AI Chat">
        <ChatLauncher />
      </WidgetErrorBoundary>
    </div>
  );
}
