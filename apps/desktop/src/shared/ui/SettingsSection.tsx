/**
 * Generic wrapper for one labeled block inside the Settings page.
 *
 * Owns the title + optional hint header. The body is whatever children get
 * passed in — usually a feature's section component.
 */

import type { ReactNode } from "react";

export function SettingsSection({
  children,
  hint,
  title,
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <div className="grid gap-2">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--lin-text-dim)]">
          {title}
        </p>
        {hint ? (
          <p className="mt-0.5 text-xs text-[var(--lin-text-mute)]">{hint}</p>
        ) : null}
      </header>
      {children}
    </div>
  );
}
