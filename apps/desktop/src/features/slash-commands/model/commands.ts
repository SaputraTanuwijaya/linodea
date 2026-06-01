/**
 * Slash-command registry — the single source of truth for the `/` commands the
 * capture input understands. Shared shape for the autocomplete dropdown and the
 * input highlighter.
 *
 * Parser-acting commands (`kind: "parse-modifier"`) take their `name` from the
 * parser package so the literal lives in exactly one place and the parser + UI
 * can't drift, and insert as `/name `. Action commands (`kind: "action"`) aren't
 * parser keywords — selecting one inserts its `template` scaffold instead (e.g.
 * `/recur` types `every ` to start a natural-language recurrence).
 */

import { COUNTDOWN_COMMAND_NAME } from "@linodea/parser";

import type { Strings } from "@/shared/i18n";

export type SlashCommandKind = "parse-modifier" | "action";

export interface SlashCommand {
  /** Bare command name without the leading slash, e.g. "countdown". */
  name: string;
  aliases?: string[];
  kind: SlashCommandKind;
  /**
   * Text inserted when an `action` command is picked (parse-modifiers insert
   * `/name ` instead). Lets `/recur` scaffold a natural-language recurrence.
   */
  template?: string;
  /** Pulls this command's localized label + description from the strings table. */
  strings: (s: Strings) => { label: string; description: string };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: COUNTDOWN_COMMAND_NAME,
    kind: "parse-modifier",
    strings: (s) => s.slash.countdown,
  },
  {
    name: "recur",
    kind: "action",
    template: "every ",
    strings: (s) => s.slash.recur,
  },
];

/** Lower-cased set of every command name + alias, for the input highlighter. */
export const SLASH_COMMAND_NAMES: ReadonlySet<string> = new Set(
  SLASH_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]).map((n) =>
    n.toLowerCase(),
  ),
);
