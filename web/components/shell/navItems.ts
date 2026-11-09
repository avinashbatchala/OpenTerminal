import type { ComponentType } from "react";
import {
  MarketsIcon,
  PortfolioIcon,
  ResearchIcon,
  ScannerIcon,
  SettingsIcon,
} from "./icons";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  shortcut: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Markets", icon: MarketsIcon, shortcut: "Alt+1" },
  { href: "/scanner", label: "Scanner", icon: ScannerIcon, shortcut: "Alt+2" },
  { href: "/portfolio", label: "Portfolio", icon: PortfolioIcon, shortcut: "Alt+3" },
  { href: "/research", label: "Research", icon: ResearchIcon, shortcut: "Alt+4" },
  { href: "/settings", label: "Settings", icon: SettingsIcon, shortcut: "Alt+5" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname.startsWith("/symbol/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
