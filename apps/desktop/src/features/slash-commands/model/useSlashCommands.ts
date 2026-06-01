/**
 * Autocomplete state for `/` commands in the capture input.
 *
 * Given the current input value and caret position, it finds the "active token"
 * (the whitespace-delimited word the caret sits in), and — when that token
 * starts with `/` — exposes the matching commands, a keyboard-navigable
 * selection, and an `apply` that rewrites the token to the full `/<name> `.
 *
 * The hook is pure state over (value, caret); the consuming component owns the
 * actual <input>, key events, and caret writes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Strings } from "@/shared/i18n";

import { SLASH_COMMANDS, type SlashCommand } from "./commands";

export interface SlashCommandSuggestion {
  command: SlashCommand;
  label: string;
  description: string;
}

export interface SlashApplyResult {
  value: string;
  caret: number;
}

export interface UseSlashCommands {
  isOpen: boolean;
  suggestions: SlashCommandSuggestion[];
  selectedIndex: number;
  moveSelection: (delta: number) => void;
  /** Rewrite for the currently highlighted suggestion (Enter / Tab). */
  applySelected: () => SlashApplyResult | null;
  /** Rewrite for a specific suggestion (mouse click). */
  applyCommand: (suggestion: SlashCommandSuggestion) => SlashApplyResult;
  /** Dismiss the menu for the current token (Esc) until the token changes. */
  close: () => void;
}

/** Boundaries of the whitespace-delimited word the caret sits in. */
function tokenBounds(value: string, caret: number): { start: number; end: number } {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1] ?? " ")) start -= 1;
  let end = caret;
  while (end < value.length && !/\s/.test(value[end] ?? " ")) end += 1;
  return { start, end };
}

export function useSlashCommands(
  value: string,
  caret: number,
  strings: Strings,
): UseSlashCommands {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  const { token, start, end } = useMemo(() => {
    const b = tokenBounds(value, caret);
    return { token: value.slice(b.start, b.end), start: b.start, end: b.end };
  }, [value, caret]);

  const suggestions = useMemo<SlashCommandSuggestion[]>(() => {
    if (!token.startsWith("/")) return [];
    const query = token.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((cmd) =>
      [cmd.name, ...(cmd.aliases ?? [])].some((n) =>
        n.toLowerCase().startsWith(query),
      ),
    ).map((command) => ({ command, ...command.strings(strings) }));
  }, [token, strings]);

  // Reset the highlight whenever the active token changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [token]);

  const isOpen =
    token.startsWith("/") && suggestions.length > 0 && dismissedToken !== token;

  const moveSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((i) => {
        const n = suggestions.length;
        return n === 0 ? 0 : (i + delta + n) % n;
      });
    },
    [suggestions.length],
  );

  const applyCommand = useCallback(
    (suggestion: SlashCommandSuggestion): SlashApplyResult => {
      // Action commands insert a scaffold template (e.g. "every "); parse
      // modifiers insert the `/name ` keyword the parser acts on.
      const insert =
        suggestion.command.kind === "action" && suggestion.command.template
          ? suggestion.command.template
          : `/${suggestion.command.name} `;
      return {
        value: value.slice(0, start) + insert + value.slice(end),
        caret: start + insert.length,
      };
    },
    [value, start, end],
  );

  const applySelected = useCallback((): SlashApplyResult | null => {
    const suggestion = suggestions[selectedIndex];
    return suggestion ? applyCommand(suggestion) : null;
  }, [suggestions, selectedIndex, applyCommand]);

  const close = useCallback(() => setDismissedToken(token), [token]);

  return {
    isOpen,
    suggestions,
    selectedIndex,
    moveSelection,
    applySelected,
    applyCommand,
    close,
  };
}
