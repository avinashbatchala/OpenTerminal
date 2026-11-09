"use client";

import { useEffect, useState } from "react";
import type {
  EquitySnapshot,
  ExecutionLiveStatus,
  ExecutionMark,
} from "./paper";

export type ExecutionLiveSnapshot = {
  marks: Record<string, ExecutionMark | null>;
  equity: EquitySnapshot | null;
  live: ExecutionLiveStatus;
  /** True while the browser's EventSource connection is open. */
  connected: boolean;
};

const EMPTY_LIVE: ExecutionLiveStatus = {
  streaming: false,
  source: null,
  lastMarkAt: null,
};

let state: ExecutionLiveSnapshot = {
  marks: {},
  equity: null,
  live: EMPTY_LIVE,
  connected: false,
};

const listeners = new Set<(snapshot: ExecutionLiveSnapshot) => void>();
let source: EventSource | null = null;

function emit(): void {
  for (const listener of listeners) listener(state);
}

function ensureSource(): void {
  if (source || typeof EventSource === "undefined") return;

  const next = new EventSource("/api/stream/execution");
  source = next;

  next.onopen = () => {
    state = { ...state, connected: true };
    emit();
  };
  next.onerror = () => {
    // EventSource reconnects by itself; keep the last marks visible.
    state = { ...state, connected: false };
    emit();
  };

  next.addEventListener("snapshot", (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data) as {
        marks?: Record<string, ExecutionMark | null>;
        equity?: EquitySnapshot | null;
        live?: Partial<ExecutionLiveStatus>;
      };
      state = {
        ...state,
        marks: data.marks ?? {},
        equity: data.equity ?? null,
        live: {
          streaming: Boolean(data.live?.streaming),
          source: data.live?.source ?? null,
          lastMarkAt: data.live?.lastMarkAt ?? null,
        },
      };
      emit();
    } catch {
      // Ignore malformed frames; EventSource keeps the stream open.
    }
  });

  next.addEventListener("mark", (event) => {
    try {
      const mark = JSON.parse((event as MessageEvent).data) as ExecutionMark;
      if (!mark?.tradeId) return;
      state = {
        ...state,
        marks: { ...state.marks, [mark.tradeId]: mark },
        live: {
          ...state.live,
          lastMarkAt: mark.markedAt,
          source: state.live.source ?? "poll",
        },
      };
      emit();
    } catch {
      // ignore
    }
  });

  next.addEventListener("equity", (event) => {
    try {
      const equity = JSON.parse((event as MessageEvent).data) as EquitySnapshot;
      if (!equity?.asOf) return;
      state = { ...state, equity };
      emit();
    } catch {
      // ignore
    }
  });
}

/**
 * Subscribe to live paper-trading marks through the Next SSE proxy. The engine
 * streams quote-driven marks when Schwab's option feed is connected and polls
 * the chain otherwise, so this hook is useful in both modes. Polling queries in
 * the widget remain the fallback when EventSource is unavailable.
 */
export function useLiveExecution(): ExecutionLiveSnapshot {
  const [snapshot, setSnapshot] = useState<ExecutionLiveSnapshot>(state);

  useEffect(() => {
    const listener = (next: ExecutionLiveSnapshot) => setSnapshot(next);
    listeners.add(listener);
    ensureSource();
    listener(state);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        source?.close();
        source = null;
        state = { ...state, connected: false };
      }
    };
  }, []);

  return snapshot;
}
