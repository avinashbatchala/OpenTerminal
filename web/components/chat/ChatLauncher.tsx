"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "./ChatProvider";
import ChatPanel from "./ChatPanel";

export default function ChatLauncher() {
  const { pending, open, unread, openChat, closeChat } = useChat();
  const [isMobile, setIsMobile] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const close = useCallback(() => {
    closeChat();
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, [closeChat]);

  const toggle = () => {
    if (open) close();
    else openChat();
  };

  const label = open
    ? "Close AI assistant panel"
    : pending
    ? "AI assistant, response pending"
    : unread === "error"
    ? "Open AI assistant, unread error"
    : unread === "success"
    ? "Open AI assistant, unread response"
    : "Open AI assistant";

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        className={`chat-launcher ${open && isMobile ? "chat-launcher--hidden" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls="ai-chat-panel"
        aria-haspopup="dialog"
        data-pending={pending ? "true" : "false"}
        data-unread={unread ?? "false"}
        onClick={toggle}
      >
        <span className="chat-launcher-text">AI</span>
      </button>

      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {!open && unread === "success"
          ? "Assistant response ready."
          : !open && unread === "error"
          ? "Assistant request failed."
          : ""}
      </span>

      {open && (
        <>
          {isMobile && <div className="chat-backdrop" aria-hidden="true" onClick={close} />}
          <ChatPanel isMobile={isMobile} onClose={close} />
        </>
      )}
    </>
  );
}
