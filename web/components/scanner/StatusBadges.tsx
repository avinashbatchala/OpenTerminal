const STATE_STYLES: Record<string, { label: string; tone: string }> = {
  watching: { label: "Watching", tone: "scanner-badge--muted" },
  entry_ready: { label: "Entry ready", tone: "scanner-badge--up" },
  invalidated: { label: "Invalidated", tone: "scanner-badge--down" },
  expired: { label: "Expired", tone: "scanner-badge--muted" },
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLES[state] ?? {
    label: state.replaceAll("_", " "),
    tone: "scanner-badge--muted",
  };
  return (
    <span className={`scanner-badge ${style.tone}`} title={`Lifecycle: ${style.label}`}>
      <span aria-hidden="true">●</span>
      {style.label}
    </span>
  );
}

export function HealthBadge({ health }: { health: string }) {
  const tone =
    health === "current"
      ? "scanner-badge--up"
      : health === "stale"
        ? "scanner-badge--amber"
        : "scanner-badge--down";
  return (
    <span className={`scanner-badge ${tone}`} title={`Data health: ${health}`}>
      {health.toUpperCase()}
    </span>
  );
}
