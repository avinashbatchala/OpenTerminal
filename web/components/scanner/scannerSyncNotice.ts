"use client";

let notice: string | null = null;
const listeners = new Set<() => void>();

export function setScannerSyncNotice(next: string | null) {
  if (notice === next) return;
  notice = next;
  listeners.forEach((listener) => listener());
}

export function subscribeScannerSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getScannerSyncNotice(): string | null {
  return notice;
}
