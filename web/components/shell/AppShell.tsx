"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTerminal } from "../../store/terminal";
import { ChatProvider, useChat } from "../chat/ChatProvider";
import ChatLauncher from "../chat/ChatLauncher";
import CommandPalette from "../CommandPalette";
import ScannerWatchlistSync from "../scanner/ScannerWatchlistSync";
import WidgetErrorBoundary from "../WidgetErrorBoundary";
import MarketBar from "./MarketBar";
import MobileNav from "./MobileNav";
import NavRail from "./NavRail";

const PAGE_SHORTCUTS: Record<string, string> = {
  "1": "/",
  "2": "/scanner",
  "3": "/portfolio",
  "4": "/research",
  "5": "/settings",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ChatProvider>
      <Shell>{children}</Shell>
    </ChatProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const setCommandOpen = useTerminal((state) => state.setCommandOpen);
  const { open, openChat, closeChat } = useChat();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (!event.altKey || event.metaKey || event.ctrlKey) return;

      if (event.code === "KeyK" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) closeChat();
        else openChat();
        return;
      }

      const digit = event.code.startsWith("Digit") ? event.code.slice(5) : event.key;
      const path = PAGE_SHORTCUTS[digit];
      if (path) {
        event.preventDefault();
        router.push(path);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeChat, open, openChat, router, setCommandOpen]);

  return (
    <div className="edge-shell">
      <a className="edge-skip" href="#edge-main">
        Skip to content
      </a>
      <NavRail />
      <div className="edge-main">
        <MarketBar />
        <main id="edge-main" className="edge-content">
          <ScannerWatchlistSync />
          {children}
        </main>
        <MobileNav />
      </div>
      <CommandPalette />
      <WidgetErrorBoundary name="AI Chat">
        <ChatLauncher />
      </WidgetErrorBoundary>
    </div>
  );
}
