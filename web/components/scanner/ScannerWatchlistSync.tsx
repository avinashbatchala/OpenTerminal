"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import type { ScannerStatus } from "../../lib/scanner";
import { useTerminal } from "../../store/terminal";
import { setScannerSyncNotice } from "./scannerSyncNotice";

type WatchlistResponse = {
  ok: boolean;
  added: string[];
  removed: string[];
  config: ScannerStatus["config"];
  status: ScannerStatus;
};

/**
 * Keeps the server watchlist in sync with the workspace watchlist. Mounted once
 * in Terminal so it runs whether or not the Opportunities widget is open.
 * Conflicts are resolved by adopting the server list; the next local edit
 * syncs normally.
 */
export default function ScannerWatchlistSync() {
  const queryClient = useQueryClient();
  const watchlist = useTerminal((state) => state.watchlist);
  const setWatchlist = useTerminal((state) => state.setWatchlist);
  const revision = useRef<number | null>(null);
  const syncedKey = useRef<string>("");
  const inFlight = useRef(false);

  const { data: status } = useQuery({
    queryKey: ["scanner", "status"],
    queryFn: () => apiGet<ScannerStatus>("/api/scanner/status", { timeoutMs: 8_000 }),
    refetchInterval: 30_000,
    retry: 0,
  });

  const sync = useMutation({
    mutationFn: (body: { symbols: string[]; baseRevision: number | null; force: boolean }) =>
      apiPost<WatchlistResponse>("/api/scanner/watchlist", body),
    onSuccess: async (data, variables) => {
      revision.current = data.config.watchlistRevision;
      syncedKey.current = data.config.watchlist.join(",");
      if (data.config.watchlist.join(",") !== variables.symbols.join(",")) {
        setWatchlist(data.config.watchlist);
        setScannerSyncNotice(
          `Only ${data.config.watchlist.length} symbols can be monitored; the synchronized list was truncated.`
        );
      } else if (data.removed.length > 0) {
        setScannerSyncNotice(
          `Watchlist removed ${data.removed.join(", ")}. Existing setups stay monitored until you choose in scanner settings.`
        );
      } else {
        setScannerSyncNotice(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["scanner"] });
    },
    onError: async (error: Error) => {
      syncedKey.current = "";
      if (!/another tab|409|conflict/i.test(error.message)) {
        setScannerSyncNotice(`Watchlist sync failed: ${error.message}`);
        return;
      }
      try {
        const fresh = await apiGet<ScannerStatus>("/api/scanner/status");
        const current = fresh.config.watchlist;
        setWatchlist(current);
        revision.current = fresh.config.watchlistRevision;
        syncedKey.current = current.join(",");
        setScannerSyncNotice("Watchlist changed in another tab; the server list was adopted.");
      } catch {
        setScannerSyncNotice("Watchlist conflict could not be resolved; retrying on the next scan.");
      }
    },
  });

  useEffect(() => {
    if (!status || inFlight.current) return;
    if (revision.current === null) revision.current = status.config.watchlistRevision;
    const key = watchlist.join(",");
    if (key === syncedKey.current) return;
    if (key === status.config.watchlist.join(",")) {
      syncedKey.current = key;
      return;
    }
    inFlight.current = true;
    void sync
      .mutateAsync({ symbols: watchlist, baseRevision: revision.current, force: false })
      .catch(() => {
        // onError records the resolution path.
      })
      .finally(() => {
        inFlight.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.config.watchlistRevision, watchlist.join(",")]);

  return null;
}
