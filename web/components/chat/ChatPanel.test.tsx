import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatKeyboardStep, defaultDesktopChatSize } from "../../lib/chatSize";
import { useTerminal } from "../../store/terminal";
import { ChatProvider } from "./ChatProvider";
import ChatPanel from "./ChatPanel";
import { CHAT_RESIZE_LABEL } from "./useChatResize";

const ROOT_FONT_SIZE = 12;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

beforeEach(() => {
  document.documentElement.style.fontSize = `${ROOT_FONT_SIZE}px`;
  setViewport(1024, 768);
  useTerminal.setState({ activeSymbol: "AAPL", commandOpen: false });
});

afterEach(() => {
  document.documentElement.style.fontSize = "";
  document.body.classList.remove("chat-resizing");
  setViewport(1024, 768);
  vi.restoreAllMocks();
});

function renderPanel({
  isMobile = true,
  onClose = vi.fn(),
}: { isMobile?: boolean; onClose?: () => void } = {}) {
  render(
    <ChatProvider>
      <ChatPanel isMobile={isMobile} onClose={onClose} />
    </ChatProvider>
  );
  return onClose;
}

function panelElement(): HTMLElement {
  return document.querySelector("#ai-chat-panel") as HTMLElement;
}

function panelSize() {
  const panel = panelElement();
  return { width: Number.parseFloat(panel.style.width), height: Number.parseFloat(panel.style.height) };
}

function resizeHandle(): HTMLElement {
  return screen.getByRole("button", { name: CHAT_RESIZE_LABEL });
}

function installPointerCapture(element: HTMLElement) {
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  const hasPointerCapture = vi.fn(() => true);
  Object.defineProperties(element, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    hasPointerCapture: { configurable: true, value: hasPointerCapture },
  });
  return { setPointerCapture, releasePointerCapture, hasPointerCapture };
}

describe("mobile chat focus ownership", () => {
  it("suspends Escape while the command palette is the top dialog and restores chat focus", async () => {
    const onClose = renderPanel();
    const composer = await screen.findByRole("textbox", { name: "Message about AAPL" });
    await waitFor(() => expect(composer).toHaveFocus());

    act(() => useTerminal.setState({ commandOpen: true }));
    expect(document.querySelector("#ai-chat-panel")).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    const outside = document.createElement("button");
    outside.textContent = "palette";
    document.body.appendChild(outside);
    outside.focus();

    act(() => useTerminal.setState({ commandOpen: false }));
    await waitFor(() => expect(composer).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("traps Tab inside the mobile sheet and wraps from last to first", async () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      { width: 1, height: 1 } as DOMRect,
    ] as unknown as DOMRectList);
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByRole("textbox", { name: "Message about AAPL" }), "x");
    const send = screen.getByRole("button", { name: "SEND" });
    send.focus();
    expect(send).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close AI assistant" })).toHaveFocus();
  });
});

describe("desktop chat resizing", () => {
  it("resizes with arrow keys and Shift for larger steps", () => {
    renderPanel({ isMobile: false });
    const handle = resizeHandle();
    const initial = defaultDesktopChatSize(ROOT_FONT_SIZE);
    const step = chatKeyboardStep(ROOT_FONT_SIZE, false);
    const largeStep = chatKeyboardStep(ROOT_FONT_SIZE, true);

    expect(handle.getAttribute("aria-label")).toContain("Hold Shift");
    expect(panelSize()).toEqual(initial);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(panelSize().width).toBe(initial.width + step);

    fireEvent.keyDown(handle, { key: "ArrowUp", shiftKey: true });
    expect(panelSize().height).toBe(initial.height + largeStep);

    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(handle, { key: "ArrowRight" });
      fireEvent.keyDown(handle, { key: "ArrowDown" });
    }
    expect(panelSize()).toEqual({ width: 216, height: 240 });
  });

  it("drags with pointer capture and cleans up on release", () => {
    renderPanel({ isMobile: false });
    const handle = resizeHandle();
    const capture = installPointerCapture(handle);
    const initial = panelSize();

    fireEvent.pointerDown(handle, { pointerId: 7, button: 0, clientX: 500, clientY: 500 });
    expect(capture.setPointerCapture).toHaveBeenCalledWith(7);
    expect(document.body).toHaveClass("chat-resizing");
    expect(handle).toHaveAttribute("data-dragging", "true");

    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 450, clientY: 460 });
    expect(panelSize()).toEqual({ width: initial.width + 50, height: initial.height + 40 });

    fireEvent.pointerUp(handle, { pointerId: 7 });
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(document.body).not.toHaveClass("chat-resizing");
    expect(handle).toHaveAttribute("data-dragging", "false");
  });

  it("restores the pre-drag size when the pointer is cancelled", () => {
    renderPanel({ isMobile: false });
    const handle = resizeHandle();
    installPointerCapture(handle);
    const initial = panelSize();

    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 430, clientY: 440 });
    expect(panelSize().width).toBeGreaterThan(initial.width);

    fireEvent.pointerCancel(handle, { pointerId: 3 });
    expect(panelSize()).toEqual(initial);
    expect(document.body).not.toHaveClass("chat-resizing");
  });

  it("cleans up drag selection state when unmounted", () => {
    const view = render(
      <ChatProvider>
        <ChatPanel isMobile={false} onClose={vi.fn()} />
      </ChatProvider>
    );
    const handle = resizeHandle();
    installPointerCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 500, clientY: 500 });
    expect(document.body).toHaveClass("chat-resizing");

    view.unmount();
    expect(document.body).not.toHaveClass("chat-resizing");
  });

  it("clamps to a shrinking viewport and keeps the preferred size", () => {
    renderPanel({ isMobile: false });
    expect(panelSize()).toEqual({ width: 288, height: 408 });

    setViewport(420, 300);
    fireEvent(window, new Event("resize"));
    expect(panelSize()).toEqual({ width: 288, height: 216 });

    setViewport(1200, 900);
    fireEvent(window, new Event("resize"));
    expect(panelSize()).toEqual({ width: 288, height: 408 });
  });

  it("disables resizing on mobile and restores the desktop size after switching back", () => {
    const onClose = vi.fn();
    const view = render(
      <ChatProvider>
        <ChatPanel isMobile={false} onClose={onClose} />
      </ChatProvider>
    );

    fireEvent.keyDown(resizeHandle(), { key: "ArrowLeft", shiftKey: true });
    const desktopWidth = panelSize().width;
    expect(desktopWidth).toBe(336);

    act(() => {
      view.rerender(
        <ChatProvider>
          <ChatPanel isMobile onClose={onClose} />
        </ChatProvider>
      );
    });
    expect(screen.queryByRole("button", { name: CHAT_RESIZE_LABEL })).toBeNull();
    expect(panelElement()).toHaveAttribute("aria-modal", "true");
    expect(panelElement().style.width).toBe("");

    act(() => {
      view.rerender(
        <ChatProvider>
          <ChatPanel isMobile={false} onClose={onClose} />
        </ChatProvider>
      );
    });
    expect(panelSize().width).toBe(desktopWidth);
  });
});
