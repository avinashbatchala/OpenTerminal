"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/api";
import type { ScannerNotification } from "../../lib/scanner";
import { NAV_ITEMS, isActivePath } from "./navItems";

export default function MobileNav() {
  const pathname = usePathname();
  const { data: unread = [] } = useQuery({
    queryKey: ["scanner", "notifications", "unread"],
    queryFn: () => apiGet<ScannerNotification[]>("/api/scanner/notifications?unread=true"),
    refetchInterval: 30_000,
    retry: 0,
  });

  return (
    <nav className="edge-mobile-nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="edge-mobile-link"
            aria-current={active ? "page" : undefined}
          >
            <span className="edge-nav-icon" aria-hidden="true">
              <Icon />
            </span>
            <span>{item.label}</span>
            {item.href === "/scanner" && unread.length > 0 && (
              <span className="sr-only">{unread.length} unread notifications</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
