import type { Metadata } from "next";
import { Host_Grotesk } from "next/font/google";
import "./globals.css";
import "./edge.css";
import Providers from "./providers";
import AppShell from "../components/shell/AppShell";

const host = Host_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-host",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenEdge trading workspace",
  description:
    "A paper-first options trading workstation: scanner, symbol workbench, portfolio and research.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={host.variable}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
