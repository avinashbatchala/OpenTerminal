import Tag, { type TagTone } from "../ui/Tag";

const STATE_STYLES: Record<string, { label: string; tone: TagTone }> = {
  watching: { label: "Watching", tone: "neutral" },
  entry_ready: { label: "Entry ready", tone: "up" },
  invalidated: { label: "Invalidated", tone: "down" },
  expired: { label: "Expired", tone: "neutral" },
  missed: { label: "Missed", tone: "accent" },
};

export function StateBadge({ state }: { state: string }) {
  const style = STATE_STYLES[state] ?? {
    label: state.replaceAll("_", " "),
    tone: "neutral" as TagTone,
  };
  return (
    <Tag tone={style.tone} title={`Lifecycle: ${style.label}`}>
      {style.label}
    </Tag>
  );
}

export function HealthBadge({ health }: { health: string }) {
  const tone: TagTone =
    health === "current" ? "up" : health === "stale" ? "accent" : "down";
  return (
    <Tag tone={tone} title={`Data health: ${health}`}>
      {health}
    </Tag>
  );
}
