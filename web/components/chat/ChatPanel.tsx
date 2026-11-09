"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { mobileChatLayout, type MobileChatLayout } from "../../lib/viewport";
import { useTerminal } from "../../store/terminal";
import { useChat } from "./ChatProvider";
import MarkdownMessage from "./MarkdownMessage";
import { useChatResize } from "./useChatResize";

type Props = {
  isMobile: boolean;
  onClose: () => void;
};

export default function ChatPanel({ isMobile, onClose }: Props) {
  const activeSymbol = useTerminal((state) => state.activeSymbol);
  const commandOpen = useTerminal((state) => state.commandOpen);
  const {
    messages,
    pending,
    draft,
    setDraft,
    unread,
    acknowledgeUnread,
    send,
    retry,
    canRetry,
    getScrollState,
    saveScrollState,
  } = useChat();
  const { size: desktopSize, dragging, handleLabel, handleProps } = useChatResize(isMobile);

  const [atBottom, setAtBottom] = useState(true);
  const [announcement, setAnnouncement] = useState("");
  const [mobileLayout, setMobileLayout] = useState<MobileChatLayout | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const wasPending = useRef(false);
  const composingRef = useRef(false);
  const paletteWasOpen = useRef(false);
  const focusBeforePalette = useRef<HTMLElement | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    saveScrollState({ top: el.scrollTop, atBottom: true });
  }, [saveScrollState]);

  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight || 0, 120)}px`;
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => composerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    resizeComposer();
  }, [draft, resizeComposer]);

  useEffect(() => {
    if (unread === "success") setAnnouncement("Assistant response ready.");
    else if (unread === "error") setAnnouncement("Assistant request failed. Retry is available.");
    acknowledgeUnread();
    // Opening the panel acknowledges the unread marker exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setMobileLayout(null);
      return;
    }
    const viewport = window.visualViewport;
    const update = () => {
      if (!viewport) {
        setMobileLayout(null);
        return;
      }
      setMobileLayout(
        mobileChatLayout(window.innerHeight, viewport.height, viewport.offsetTop)
      );
    };
    update();
    if (viewport) {
      viewport.addEventListener("resize", update);
      viewport.addEventListener("scroll", update);
      return () => {
        viewport.removeEventListener("resize", update);
        viewport.removeEventListener("scroll", update);
      };
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [isMobile]);

  useEffect(() => {
    if (commandOpen && !paletteWasOpen.current) {
      const active = document.activeElement;
      if (panelRef.current?.contains(active)) {
        focusBeforePalette.current = active as HTMLElement;
      }
    } else if (!commandOpen && paletteWasOpen.current) {
      const target = focusBeforePalette.current;
      focusBeforePalette.current = null;
      if (target?.isConnected) target.focus();
    }
    paletteWasOpen.current = commandOpen;
  }, [commandOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || commandOpen) return;
      // Desktop chat is nonmodal: Escape should only close it when focus is
      // inside the panel. The mobile sheet behaves as a modal.
      if (!isMobile && !panelRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commandOpen, isMobile, onClose]);

  useEffect(() => {
    if (!isMobile || commandOpen) return;
    const panel = panelRef.current;
    if (!panel) return;

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [commandOpen, isMobile]);

  useEffect(() => {
    if (pending && !wasPending.current) {
      setAnnouncement("Assistant is responding.");
    } else if (!pending && wasPending.current) {
      const last = messages[messages.length - 1];
      setAnnouncement(
        last?.role === "assistant"
          ? "Assistant response ready."
          : "Assistant request failed. Retry is available."
      );
    }
    wasPending.current = pending;
  }, [messages, pending]);

  // Restore the previous scroll position when the panel is reopened.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = getScrollState();
    atBottomRef.current = saved.atBottom;
    setAtBottom(saved.atBottom);
    el.scrollTop = saved.atBottom ? el.scrollHeight : saved.top;
  }, [getScrollState]);

  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [messages, pending, scrollToBottom]);

  // Keep the newest message pinned while resizing, but never pull the user
  // away from older messages they are reading.
  useLayoutEffect(() => {
    if (atBottomRef.current) scrollToBottom();
  }, [desktopSize?.height, desktopSize?.width, mobileLayout?.height, scrollToBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    atBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
    saveScrollState({ top: el.scrollTop, atBottom: nearBottom });
  };

  const jumpToLatest = () => {
    atBottomRef.current = true;
    setAtBottom(true);
    scrollToBottom();
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || pending) return;
    atBottomRef.current = true;
    setAtBottom(true);
    saveScrollState({ top: 0, atBottom: true });
    // Capture the ticker at send time; later terminal changes must not alter it.
    send(text, activeSymbol);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    submit();
  };

  const onComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composingRef.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const panelStyle =
    isMobile && mobileLayout
      ? { height: `${mobileLayout.height}px`, bottom: `${mobileLayout.bottom}px` }
      : !isMobile && desktopSize
      ? { width: `${desktopSize.width}px`, height: `${desktopSize.height}px` }
      : undefined;

  return (
    <div
      ref={panelRef}
      id="ai-chat-panel"
      role="dialog"
      aria-modal={(isMobile && !commandOpen) || undefined}
      aria-hidden={commandOpen || undefined}
      inert={commandOpen || undefined}
      aria-labelledby="ai-chat-title"
      aria-busy={pending}
      tabIndex={-1}
      className={`chat-panel flex flex-col ${
        isMobile ? "chat-panel--mobile" : "chat-panel--desktop"
      } ${dragging ? "chat-panel--resizing" : ""}`}
      style={panelStyle}
    >
      {!isMobile && (
        <button
          type="button"
          className="chat-resize-handle"
          aria-label={handleLabel}
          title={handleLabel}
          data-dragging={dragging ? "true" : "false"}
          {...handleProps}
        />
      )}

      <div className="panel-title" style={{ cursor: "default" }}>
        <span id="ai-chat-title">AI ASSISTANT</span>
        <span className="flex items-center gap-2">
          <span className="chat-symbol-pill" title="Active ticker supplied to new messages">
            {activeSymbol}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI assistant"
            className="chat-close"
          >
            ✕
          </button>
        </span>
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        role="log"
        aria-label="Conversation"
        aria-live="off"
        className="flex-1 overflow-y-auto min-h-0 p-2 space-y-2"
      >
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. I can pull live quotes,
            price history, option chains, news, insider transactions, and macro data from the terminal.
          </div>
        )}

        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          return (
            <div key={message.id} className="chat-message">
              {message.role === "user" ? (
                <>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="amber">You</span>
                    {message.symbol && (
                      <span className="chat-symbol-pill chat-symbol-pill--muted">{message.symbol}</span>
                    )}
                    {message.status === "sending" && <span className="dim">sending…</span>}
                  </div>
                  <div className="whitespace-pre-wrap mt-0.5">{message.content}</div>
                  {message.status === "failed" && (
                    <div className="mt-1 flex items-start gap-2">
                      <div className="down text-[11px] flex-1">{message.error ?? "The assistant request failed."}</div>
                      {isLast && canRetry(message.id) && (
                        <button
                          type="button"
                          className="term-btn chat-retry shrink-0"
                          onClick={() => retry(message.id)}
                          disabled={pending}
                        >
                          RETRY
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-[10px] up">AI</div>
                  <div className="mt-0.5">
                    <MarkdownMessage content={message.content} />
                  </div>
                  {message.tools && message.tools.length > 0 && (
                    <div className="dim text-[10px] mt-1">
                      used: {[...new Set(message.tools.map((tool) => tool.name))].join(", ")}
                      {message.tools.some((tool) => !tool.ok) ? " (some lookups failed)" : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {pending && (
          <div className="dim flex items-center gap-2 text-[11px]" aria-hidden="true">
            <span className="chat-pending-dot" />
            thinking and fetching terminal data…
          </div>
        )}
      </div>

      {!atBottom && (
        <div className="px-2 pb-1">
          <button type="button" className="chat-latest" onClick={jumpToLatest}>
            ↓ LATEST
          </button>
        </div>
      )}

      <form onSubmit={onSubmit} className="chat-composer flex items-end gap-2 p-2 border-t border-[var(--border)] shrink-0">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          rows={2}
          maxLength={4000}
          placeholder={`Ask about ${activeSymbol}…  (Enter to send, Shift+Enter for a new line)`}
          aria-label={`Message about ${activeSymbol}`}
          enterKeyHint="send"
          autoComplete="off"
          className="flex-1 min-w-0"
        />
        <button
          type="submit"
          className="term-btn chat-send shrink-0"
          disabled={pending || !draft.trim()}
        >
          SEND
        </button>
      </form>
    </div>
  );
}
