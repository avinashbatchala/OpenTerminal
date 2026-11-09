"use client";

import dynamic from "next/dynamic";

const ResearchPage = dynamic(() => import("../../components/research/ResearchPage"), { ssr: false });

export default function ResearchRoute() {
  return <ResearchPage />;
}
