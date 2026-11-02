"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatKeyboardStep,
  clampChatSize,
  defaultDesktopChatSize,
  desktopChatSizeBounds,
  resizeChatSize,
  type ChatSize,
} from "../../lib/chatSize";
import { readDesktopChatViewport, type DesktopChatViewport } from "../../lib/viewport";
import { useChat } from "./ChatProvider";

const RESIZING_CLASS = "chat-resizing";

export const CHAT_RESIZE_LABEL =
  "Resize AI assistant panel. Left and Up enlarge; Right and Down shrink. Hold Shift for larger steps.";

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startSize: ChatSize;
};

function initialViewport(): DesktopChatViewport {
  return readDesktopChatViewport(typeof window === "undefined" ? undefined : window);
}

export function useChatResize(isMobile: boolean) {
  const { desktopChatSize, setDesktopChatSize } = useChat();
  const [viewport, setViewport] = useState(initialViewport);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const bounds = useMemo(
    () =>
      desktopChatSizeBounds({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        rootFontSize: viewport.rootFontSize,
        insets: viewport.insets,
      }),
    [viewport]
  );

  const size = clampChatSize(
    desktopChatSize ?? defaultDesktopChatSize(viewport.rootFontSize),
    bounds
  );

  useEffect(() => {
    if (isMobile || typeof window === "undefined") return;
    const win = window;
    const visualViewport = win.visualViewport;
    const update = () => setViewport(readDesktopChatViewport(win));
    update();
    win.addEventListener("resize", update);
    visualViewport?.addEventListener("resize", update);
    visualViewport?.addEventListener("scroll", update);
    return () => {
      win.removeEventListener("resize", update);
      visualViewport?.removeEventListener("resize", update);
      visualViewport?.removeEventListener("scroll", update);
    };
  }, [isMobile]);

  // Pointer capture keeps all drag events on the handle, but unmounting the
  // panel can leave the body in its no-select state.
  useEffect(
    () => () => {
      dragRef.current = null;
      document.body.classList.remove(RESIZING_CLASS);
    },
    []
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, cancel: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove(RESIZING_CLASS);
      if (cancel) setDesktopChatSize(drag.startSize);

      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Pointer capture can already be gone after cancellation.
      }
    },
    [setDesktopChatSize]
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (isMobile || event.button !== 0 || dragRef.current) return;
      const target = event.currentTarget;
      if (typeof target.setPointerCapture !== "function") return;

      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Without capture, drags can escape the handle; don't start one.
        return;
      }

      event.preventDefault();
      target.focus();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startSize: size,
      };
      setDragging(true);
      document.body.classList.add(RESIZING_CLASS);
    },
    [isMobile, size]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      setDesktopChatSize(
        resizeChatSize(
          drag.startSize,
          {
            width: drag.startX - event.clientX,
            height: drag.startY - event.clientY,
          },
          bounds
        )
      );
    },
    [bounds, setDesktopChatSize]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => finishDrag(event, false),
    [finishDrag]
  );
  const onPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => finishDrag(event, true),
    [finishDrag]
  );
  const onLostPointerCapture = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      document.body.classList.remove(RESIZING_CLASS);
    },
    []
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const step = chatKeyboardStep(viewport.rootFontSize, event.shiftKey);
      let width = 0;
      let height = 0;

      switch (event.key) {
        case "ArrowLeft":
          width = step;
          break;
        case "ArrowRight":
          width = -step;
          break;
        case "ArrowUp":
          height = step;
          break;
        case "ArrowDown":
          height = -step;
          break;
        default:
          return;
      }

      event.preventDefault();
      setDesktopChatSize(resizeChatSize(size, { width, height }, bounds));
    },
    [bounds, setDesktopChatSize, size, viewport.rootFontSize]
  );

  return {
    size: isMobile ? null : size,
    dragging,
    handleLabel: CHAT_RESIZE_LABEL,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onKeyDown,
    },
  };
}
