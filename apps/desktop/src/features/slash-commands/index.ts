/**
 * Public surface for the slash-commands feature.
 */

export { SLASH_COMMANDS, type SlashCommand } from "./model/commands";
export {
  useSlashCommands,
  type SlashApplyResult,
  type SlashCommandSuggestion,
  type UseSlashCommands,
} from "./model/useSlashCommands";
export { SlashCommandMenu } from "./ui/SlashCommandMenu";
export { HighlightedInput } from "./ui/HighlightedInput";
