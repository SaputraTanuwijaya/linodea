/**
 * Theme picker section.
 *
 * Renders the grid of theme cards. ThemeCard + ThemeSwatchPreview are
 * internal — only ThemeSection is exported.
 */

import type { Strings } from "@/shared/i18n";

import { THEMES, type ThemeDefinition, type ThemeId } from "../model/themes";

export function ThemeSection({
  activeTheme,
  onThemeChange,
  strings,
}: {
  activeTheme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  strings: Strings;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {THEMES.map((theme) => (
        <ThemeCard
          isActive={theme.id === activeTheme}
          key={theme.id}
          onSelect={() => onThemeChange(theme.id)}
          strings={strings}
          theme={theme}
        />
      ))}
    </div>
  );
}

function ThemeCard({
  isActive,
  onSelect,
  strings,
  theme,
}: {
  isActive: boolean;
  onSelect: () => void;
  strings: Strings;
  theme: ThemeDefinition;
}) {
  const ring = isActive
    ? "ring-2 ring-[var(--lin-text)]"
    : "ring-1 ring-[var(--lin-border)] hover:ring-[var(--lin-text-dim)]";
  const localized = strings.themes[theme.id];

  return (
    <button
      aria-pressed={isActive}
      className={`flex items-center gap-3 rounded-xl bg-[var(--lin-bg-hover)] p-2.5 text-left transition ${ring}`}
      onClick={onSelect}
      type="button"
    >
      <ThemeSwatchPreview theme={theme} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--lin-text)]">
          {localized.name}
        </p>
        <p className="truncate text-xs text-[var(--lin-text-dim)]">
          {localized.description}
        </p>
      </div>
    </button>
  );
}

function ThemeSwatchPreview({ theme }: { theme: ThemeDefinition }) {
  return (
    <div
      className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-[var(--lin-border)]"
      style={{ background: theme.swatch.bg }}
    >
      <div
        className="absolute bottom-0 left-0 right-0 h-1/2"
        style={{ background: theme.swatch.surface }}
      />
      <div
        className="absolute left-1.5 top-1.5 h-1.5 w-4 rounded-full"
        style={{ background: theme.swatch.text }}
      />
    </div>
  );
}
