import { ZERO_CHAT_INSETS, type ChatInsets } from "./chatSize";

export type MobileChatLayout = { height: number; bottom: number };
export type DesktopChatViewport = {
  width: number;
  height: number;
  rootFontSize: number;
  insets: ChatInsets;
};

/**
 * Keep the mobile chat sheet inside the visual viewport when the software
 * keyboard opens. `bottom` is the distance from the layout viewport bottom to
 * the visual viewport bottom, i.e. the keyboard inset.
 */
export function mobileChatLayout(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
  maxHeight = 704
): MobileChatLayout {
  const viewportHeight = Math.max(1, visualHeight);
  const inset = Math.max(0, innerHeight - viewportHeight - Math.max(0, visualOffsetTop));
  return {
    height: Math.min(viewportHeight * 0.8, maxHeight),
    bottom: inset,
  };
}

function px(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Read the CSS safe-area insets without affecting layout. */
export function readSafeAreaInsets(doc: Document): ChatInsets {
  if (!doc.body) return { ...ZERO_CHAT_INSETS };

  const probe = doc.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top)",
    "padding-right:env(safe-area-inset-right)",
    "padding-bottom:env(safe-area-inset-bottom)",
    "padding-left:env(safe-area-inset-left)",
  ].join(";");
  doc.body.appendChild(probe);

  try {
    const style = doc.defaultView?.getComputedStyle(probe);
    return {
      top: px(style?.paddingTop),
      right: px(style?.paddingRight),
      bottom: px(style?.paddingBottom),
      left: px(style?.paddingLeft),
    };
  } finally {
    probe.remove();
  }
}

export function readDesktopChatViewport(win?: Window): DesktopChatViewport {
  if (!win) {
    return { width: 1024, height: 768, rootFontSize: 12, insets: { ...ZERO_CHAT_INSETS } };
  }
  const doc = win.document;
  const rootFontSize = px(win.getComputedStyle(doc.documentElement).fontSize) || 16;
  return {
    width: Math.max(1, win.innerWidth || doc.documentElement.clientWidth),
    height: Math.max(1, win.innerHeight || doc.documentElement.clientHeight),
    rootFontSize,
    insets: readSafeAreaInsets(doc),
  };
}
