import { describe, expect, it } from "vitest";
import {
  chatKeyboardStep,
  clampChatSize,
  defaultDesktopChatSize,
  desktopChatSizeBounds,
  resizeChatSize,
  ZERO_CHAT_INSETS,
} from "./chatSize";

const root = 12;

describe("desktop chat size", () => {
  it("scales defaults and minimums from the actual root font size", () => {
    expect(defaultDesktopChatSize(12)).toEqual({ width: 288, height: 408 });
    expect(defaultDesktopChatSize(20)).toEqual({ width: 480, height: 680 });

    const bounds = desktopChatSizeBounds({
      viewportWidth: 1200,
      viewportHeight: 900,
      rootFontSize: 20,
      insets: ZERO_CHAT_INSETS,
    });
    expect(bounds.minWidth).toBe(360);
    expect(bounds.minHeight).toBe(400);
  });

  it("clamps to sensible minimums", () => {
    const bounds = desktopChatSizeBounds({
      viewportWidth: 1024,
      viewportHeight: 768,
      rootFontSize: root,
      insets: ZERO_CHAT_INSETS,
    });

    expect(clampChatSize({ width: 100, height: 100 }, bounds)).toEqual({
      width: 216,
      height: 240,
    });
  });

  it("clamps maximums to the viewport and safe areas", () => {
    const bounds = desktopChatSizeBounds({
      viewportWidth: 500,
      viewportHeight: 400,
      rootFontSize: root,
      insets: { top: 5, right: 10, bottom: 20, left: 15 },
    });

    expect(bounds).toEqual({
      minWidth: 216,
      minHeight: 240,
      maxWidth: 451,
      maxHeight: 291,
    });
    expect(clampChatSize({ width: 2000, height: 2000 }, bounds)).toEqual({
      width: 451,
      height: 291,
    });
  });

  it("shrinks the minimum when the viewport cannot fit it", () => {
    const bounds = desktopChatSizeBounds({
      viewportWidth: 200,
      viewportHeight: 200,
      rootFontSize: root,
      insets: ZERO_CHAT_INSETS,
    });

    expect(bounds).toEqual({
      minWidth: 176,
      minHeight: 116,
      maxWidth: 176,
      maxHeight: 116,
    });
    expect(clampChatSize(defaultDesktopChatSize(root), bounds)).toEqual({
      width: 176,
      height: 116,
    });
  });

  it("keeps the preferred size through a temporary viewport shrink", () => {
    const preferred = defaultDesktopChatSize(root);
    const normal = desktopChatSizeBounds({
      viewportWidth: 1280,
      viewportHeight: 900,
      rootFontSize: root,
      insets: ZERO_CHAT_INSETS,
    });
    const shrunken = desktopChatSizeBounds({
      viewportWidth: 400,
      viewportHeight: 300,
      rootFontSize: root,
      insets: ZERO_CHAT_INSETS,
    });

    expect(clampChatSize(preferred, normal)).toEqual(preferred);
    expect(clampChatSize(preferred, shrunken)).toEqual({ width: 288, height: 216 });
    expect(clampChatSize(preferred, normal)).toEqual(preferred);
  });

  it("applies pointer deltas and clamps both directions", () => {
    const bounds = desktopChatSizeBounds({
      viewportWidth: 640,
      viewportHeight: 480,
      rootFontSize: root,
      insets: ZERO_CHAT_INSETS,
    });

    expect(resizeChatSize({ width: 300, height: 350 }, { width: 50, height: 50 }, bounds)).toEqual({
      width: 350,
      height: 396,
    });
    expect(resizeChatSize({ width: 300, height: 350 }, { width: -500, height: -500 }, bounds)).toEqual({
      width: 216,
      height: 240,
    });
    expect(resizeChatSize({ width: 300, height: 350 }, { width: 500, height: 500 }, bounds)).toEqual({
      width: 616,
      height: 396,
    });
  });

  it("uses a larger modifier step", () => {
    expect(chatKeyboardStep(12, false)).toBe(12);
    expect(chatKeyboardStep(12, true)).toBe(48);
    expect(chatKeyboardStep(20, false)).toBe(20);
  });
});
