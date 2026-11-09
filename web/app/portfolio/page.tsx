"use client";

import dynamic from "next/dynamic";

const PortfolioPage = dynamic(() => import("../../components/portfolio/PortfolioPage"), { ssr: false });

export default function PortfolioRoute() {
  return <PortfolioPage />;
}
