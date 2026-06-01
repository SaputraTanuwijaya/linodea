/**
 * The `/`-command autocomplete dropdown. Stateless: selection + filtering live
 * in `useSlashCommands`; this just renders the list and reports picks.
 *
 * Drops *down* below the capture field — the capture form is anchored to the
 * window top and the window grows downward when the menu opens, so down is
 * where the room is. Mirrors `widgets/popup-menu` styling.
 */

import type { SlashCommandSuggestion } from "../model/useSlashCommands";

export function SlashCommandMenu({
  onPick,
  selectedIndex,
  suggestions,
}: {
  onPick: (suggestion: SlashCommandSuggestion) => void;
  selectedIndex: number;
  suggestions: SlashCommandSuggestion[];
}) {
  return (
    <div
      className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg)] p-1 shadow-2xl"
      role="listbox"
    >
      {suggestions.map((suggestion, index) => (
        <button
          aria-selected={index === selectedIndex}
          className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-1.5 text-left transition ${
            index === selectedIndex ? "bg-[var(--lin-bg-hover)]" : ""
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
          <span className="text-sm font-medium text-yellow-400">
            {suggestion.label}
          </span>
          <span className="truncate text-xs text-[var(--lin-text-dim)]">
            {suggestion.description}
          </span>
        </button>
      ))}
    </div>
  );
}
