"use client";

import dynamic from "next/dynamic";

const SymbolPage = dynamic(() => import("../../../components/symbol/SymbolPage"), { ssr: false });

export default function SymbolRoute() {
  return <SymbolPage />;
}
