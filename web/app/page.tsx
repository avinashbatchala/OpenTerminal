"use client";

import dynamic from "next/dynamic";

const MarketsPage = dynamic(() => import("../components/markets/MarketsPage"), { ssr: false });

export default function Home() {
  return <MarketsPage />;
}
