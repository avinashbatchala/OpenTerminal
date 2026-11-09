"use client";

import { useMemo } from "react";
import { formatUsd } from "../../lib/scanner";
import type { EquitySnapshot } from "../../lib/paper";

const WIDTH = 640;
const HEIGHT = 180;
const PAD = 12;

function timeLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** A small, dependency-free equity curve for the paper account. */
export default function EquityChart({
  history,
  latest,
}: {
  history: EquitySnapshot[];
  latest: EquitySnapshot | null;
}) {
  const points = useMemo(() => {
    const rows = [...history];
    if (latest && !rows.some((row) => row.asOf === latest.asOf)) rows.push(latest);
    return rows
      .filter((row) => Number.isFinite(row.equityUsd))
      .sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
  }, [history, latest]);

  if (points.length < 2) {
    return (
      <div className="edge-empty edge-equity-empty">
        Equity history builds as live marks and fills arrive.
      </div>
    );
  }

  const values = points.map((point) => point.equityUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.001);
  const x = (index: number) => PAD + (index / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (value: number) =>
    HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2);
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.equityUsd).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},${HEIGHT - PAD} L${PAD},${HEIGHT - PAD} Z`;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="edge-equity-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Paper equity from ${formatUsd(first.equityUsd)} at ${timeLabel(first.asOf)} to ${formatUsd(last.equityUsd)} at ${timeLabel(last.asOf)}`}
      >
        <line
          className="edge-equity-baseline"
          x1={PAD}
          x2={WIDTH - PAD}
          y1={y(first.equityUsd)}
          y2={y(first.equityUsd)}
          vectorEffect="non-scaling-stroke"
        />
        <path className="edge-equity-area" d={area} />
        <path className="edge-equity-line" d={line} vectorEffect="non-scaling-stroke" />
        <circle
          className="edge-equity-dot"
          cx={x(points.length - 1)}
          cy={y(last.equityUsd)}
          r={4}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="edge-equity-axis" aria-hidden="true">
        <span>{timeLabel(first.asOf)}</span>
        <span>
          Low {formatUsd(min)}, high {formatUsd(max)}
        </span>
        <span>{timeLabel(last.asOf)}</span>
      </div>
    </div>
  );
}
