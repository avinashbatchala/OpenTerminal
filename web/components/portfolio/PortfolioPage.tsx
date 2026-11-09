"use client";

import PaperWidget from "../widgets/PaperWidget";
import { PageHeader, Surface } from "../shell/Surface";

export default function PortfolioPage() {
  return (
    <div className="edge-page">
      <PageHeader
        title="Portfolio"
        lead="Paper equity, open positions, fills and the automation that manages them."
      />
      <Surface flush className="edge-paper-page">
        <div className="edge-paper-body">
          <PaperWidget />
        </div>
      </Surface>
    </div>
  );
}
