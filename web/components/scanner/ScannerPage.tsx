"use client";

import OpportunitiesWidget from "../widgets/OpportunitiesWidget";
import { PageHeader, Surface } from "../shell/Surface";

export default function ScannerPage() {
  return (
    <div className="edge-page">
      <PageHeader
        title="Scanner"
        lead="Setups moving from watching to entry ready, with the option package and paper action in one place."
      />
      <Surface flush className="edge-scanner-page">
        <div className="edge-scanner-body">
          <OpportunitiesWidget />
        </div>
      </Surface>
    </div>
  );
}
