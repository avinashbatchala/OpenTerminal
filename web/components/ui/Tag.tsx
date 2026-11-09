import type { ReactNode } from "react";

export type TagTone = "neutral" | "up" | "down" | "accent";

/** One rectangular tag across the app: only the tone colours change. */
export default function Tag({
  tone = "neutral",
  title,
  className,
  children,
}: {
  tone?: TagTone;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`tag tag--${tone}${className ? ` ${className}` : ""}`} title={title}>
      {children}
    </span>
  );
}
