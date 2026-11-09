"use client";

import PaperWidget from "../widgets/PaperWidget";
import { PageHeader } from "../shell/Surface";

export default function PortfolioPage() {
  return (
    <div className="edge-page edge-portfolio-page">
      <PageHeader
        title="Portfolio"
        lead="Paper equity, open positions, fills and the automation that manages them."
      />
      <PaperWidget />
    </div>
  );
}
