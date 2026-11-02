import { describe, expect, it } from "vitest";
import { mobileChatLayout, readDesktopChatViewport } from "./viewport";

describe("mobileChatLayout", () => {
  it("sits at the bottom when the keyboard is closed", () => {
    expect(mobileChatLayout(844, 844, 0)).toEqual({ height: 675.2, bottom: 0 });
  });

  it("moves above the software keyboard", () => {
    expect(mobileChatLayout(844, 500, 0)).toEqual({ height: 400, bottom: 344 });
  });

  it("accounts for a scrolled visual viewport", () => {
    expect(mobileChatLayout(844, 500, 100)).toEqual({ height: 400, bottom: 244 });
  });

  it("caps very tall sheets", () => {
    expect(mobileChatLayout(1600, 1600, 0, 704)).toEqual({ height: 704, bottom: 0 });
  });
});

describe("readDesktopChatViewport", () => {
  it("reads the actual root font size, viewport, and safe-area probe", () => {
    const previousFont = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = "12px";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });

    try {
      expect(readDesktopChatViewport(window)).toEqual({
        width: 800,
        height: 600,
        rootFontSize: 12,
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } finally {
      document.documentElement.style.fontSize = previousFont;
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    }
  });
});
