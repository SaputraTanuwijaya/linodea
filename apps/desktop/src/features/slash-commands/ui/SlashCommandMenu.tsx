/**
 * The `/`-command autocomplete dropdown. Stateless: selection + filtering live
 * in `useSlashCommands`; this just renders the list and reports picks.
 *
 * Drops *down* below the capture field — the capture form is anchored to the
 * window top and the window grows downward when the menu opens, so down is
 * where the room is. Mirrors `widgets/popup-menu` styling.
 */

import type { Strings } from "@/shared/i18n";

import type { SlashCommandSuggestion } from "../model/useSlashCommands";

export function SlashCommandMenu({
  onPick,
  selectedIndex,
  strings,
  suggestions,
}: {
  onPick: (suggestion: SlashCommandSuggestion) => void;
  selectedIndex: number;
  strings: Strings;
  suggestions: SlashCommandSuggestion[];
}) {
  return (
    <div
      className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-[var(--lin-border)] bg-[var(--lin-bg)] shadow-2xl"
      role="listbox"
    >
      <div className="flex items-center justify-between border-b border-[var(--lin-border)] px-3 py-2">
        <span className="text-xs font-medium text-[var(--lin-text-dim)]">
          {strings.slash.menuTitle}
        </span>
        <span className="text-[11px] text-[var(--lin-text-mute)]">
          {strings.slash.menuHint}
        </span>
      </div>
      <div className="p-1.5">
        {suggestions.map((suggestion, index) => (
          <button
            aria-selected={index === selectedIndex}
            className={`grid min-h-14 w-full grid-cols-[92px_minmax(0,1fr)] items-center gap-3 rounded-md border-l-2 px-3 py-2 text-left transition ${
              index === selectedIndex
                ? "border-yellow-400 bg-[var(--lin-bg-hover)]"
                : "border-transparent"
            }`}
            key={suggestion.command.name}
            // mouseDown (not click) so the rewrite lands before the input blurs.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(suggestion);
            }}
            role="option"
            type="button"
          >
            <span className="text-sm font-semibold text-yellow-400">
              {suggestion.label}
            </span>
            <span className="min-w-0 text-xs leading-4 text-[var(--lin-text-dim)]">
              {suggestion.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
