"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/api";
import type { ScannerNotification } from "../lib/scanner";

export default function OpportunitiesLink() {
  const { data = [] } = useQuery({
    queryKey: ["scanner", "notifications", "unread"],
    queryFn: () => apiGet<ScannerNotification[]>("/api/scanner/notifications?unread=true"),
    refetchInterval: 30_000,
    retry: 0,
  });

  return (
    <Link
      href="/opportunities"
      className="relative flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--amber)]"
      title="Opportunity scanner"
    >
      OPPORTUNITIES
      {data.length > 0 && (
        <span
          aria-label={`${data.length} unread scanner notifications`}
          className="min-w-4 h-4 px-1 rounded-full bg-[var(--down)] text-black text-[9px] font-bold flex items-center justify-center"
        >
          {data.length > 99 ? "99+" : data.length}
        </span>
      )}
    </Link>
  );
}
