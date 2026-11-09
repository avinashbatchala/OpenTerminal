"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import type { ScannerNotification } from "../../lib/scanner";
import { NAV_ITEMS, isActivePath } from "./navItems";

export default function NavRail() {
  const pathname = usePathname();
  const { data: unread = [] } = useQuery({
    queryKey: ["scanner", "notifications", "unread"],
    queryFn: () => apiGet<ScannerNotification[]>("/api/scanner/notifications?unread=true"),
    refetchInterval: 30_000,
    retry: 0,
  });

  return (
    <nav className="edge-nav" aria-label="Primary">
      <Link href="/" className="edge-brand" aria-label="OpenEdge home">
        <span className="edge-brand-mark" aria-hidden="true">
          OE
        </span>
        <span className="edge-brand-name">OpenEdge</span>
      </Link>

      <div className="edge-nav-links">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="edge-nav-link"
              aria-current={active ? "page" : undefined}
              title={`${item.label} (${item.shortcut})`}
            >
              <span className="edge-nav-icon">
                <Icon />
              </span>
              <span>{item.label}</span>
              {item.href === "/scanner" && unread.length > 0 && (
                <span
                  className="edge-nav-badge"
                  aria-label={`${unread.length} unread scanner notifications`}
                >
                  {unread.length > 99 ? "99+" : unread.length}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="edge-nav-foot">
        <strong>Paper account</strong>
        Simulated fills. No live orders.
      </div>
    </nav>
  );
}
