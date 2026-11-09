import type { ReactNode } from "react";

export function Surface({
  title,
  sub,
  action,
  children,
  flush = false,
  className = "",
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`edge-surface ${className}`}>
      {(title || action) && (
        <header className="edge-surface-head">
          <div className="flex min-w-0 items-baseline gap-2">
            {title && <h2 className="edge-surface-title">{title}</h2>}
            {sub && <span className="edge-surface-sub">{sub}</span>}
          </div>
          {action}
        </header>
      )}
      <div className={flush ? "edge-surface-body--flush" : "edge-surface-body"}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string;
  lead?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="edge-page-head">
      <div>
        <h1 className="edge-page-title">{title}</h1>
        {lead && <p className="edge-page-lead">{lead}</p>}
      </div>
      {actions && <div className="edge-page-actions">{actions}</div>}
    </header>
  );
}
