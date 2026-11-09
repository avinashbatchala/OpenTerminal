"use client";

import dynamic from "next/dynamic";

const ScannerPage = dynamic(() => import("../../components/scanner/ScannerPage"), { ssr: false });

export default function ScannerRoute() {
  return <ScannerPage />;
}
