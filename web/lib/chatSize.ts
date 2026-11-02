export type ChatSize = { width: number; height: number };
export type ChatSizeDelta = { width: number; height: number };
export type ChatInsets = { top: number; right: number; bottom: number; left: number };

export type ChatSizeBounds = {
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
};

export type ChatSizeViewport = {
  viewportWidth: number;
  viewportHeight: number;
  rootFontSize: number;
  insets?: ChatInsets;
};

export const ZERO_CHAT_INSETS: ChatInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Desktop panel geometry, expressed in root-relative units. The app sets a
 * 12px root font size, so these values follow the terminal rather than an
 * assumed 16px browser default.
 */
export const CHAT_RESIZE_METRICS = {
  edgeRem: 1,
  topGapRem: 2,
  bottomGapRem: 5,
  minWidthRem: 18,
  minHeightRem: 20,
  defaultWidthRem: 24,
  defaultHeightRem: 34,
  keyboardStepRem: 1,
  keyboardLargeStepRem: 4,
} as const;

function positiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function defaultDesktopChatSize(rootFontSize: number): ChatSize {
  const root = positiveNumber(rootFontSize);
  return {
    width: Math.round(CHAT_RESIZE_METRICS.defaultWidthRem * root),
    height: Math.round(CHAT_RESIZE_METRICS.defaultHeightRem * root),
  };
}

/**
 * Maximums leave the bottom-right anchor (right: 1rem, bottom: 5rem) and the
 * top/left safe areas untouched. Minimums shrink only when the viewport cannot
 * physically fit them, so the panel is never larger than the visible area.
 */
export function desktopChatSizeBounds({
  viewportWidth,
  viewportHeight,
  rootFontSize,
  insets = ZERO_CHAT_INSETS,
}: ChatSizeViewport): ChatSizeBounds {
  const root = positiveNumber(rootFontSize);
  const maxWidth = Math.max(
    1,
    Math.round(
      positiveNumber(viewportWidth) -
        CHAT_RESIZE_METRICS.edgeRem * 2 * root -
        insets.left -
        insets.right
    )
  );
  const maxHeight = Math.max(
    1,
    Math.round(
      positiveNumber(viewportHeight) -
        (CHAT_RESIZE_METRICS.topGapRem + CHAT_RESIZE_METRICS.bottomGapRem) * root -
        insets.top -
        insets.bottom
    )
  );

  return {
    minWidth: Math.min(Math.round(CHAT_RESIZE_METRICS.minWidthRem * root), maxWidth),
    minHeight: Math.min(Math.round(CHAT_RESIZE_METRICS.minHeightRem * root), maxHeight),
    maxWidth,
    maxHeight,
  };
}

export function clampChatSize(size: ChatSize, bounds: ChatSizeBounds): ChatSize {
  return {
    width: clamp(Math.round(positiveNumber(size.width)), bounds.minWidth, bounds.maxWidth),
    height: clamp(Math.round(positiveNumber(size.height)), bounds.minHeight, bounds.maxHeight),
  };
}

export function resizeChatSize(
  start: ChatSize,
  delta: ChatSizeDelta,
  bounds: ChatSizeBounds
): ChatSize {
  return clampChatSize(
    {
      width: start.width + delta.width,
      height: start.height + delta.height,
    },
    bounds
  );
}

export function chatKeyboardStep(rootFontSize: number, large: boolean): number {
  const root = positiveNumber(rootFontSize);
  return Math.round(
    (large ? CHAT_RESIZE_METRICS.keyboardLargeStepRem : CHAT_RESIZE_METRICS.keyboardStepRem) *
      root
  );
}
