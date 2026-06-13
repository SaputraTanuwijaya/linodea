import type { AiProviderId } from "./types";

export interface AiProviderDefinition {
  id: AiProviderId;
  name: string;
  available: boolean;
  recommended: boolean;
}

export const AI_PROVIDERS: readonly AiProviderDefinition[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    available: true,
    recommended: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    available: false,
    recommended: false,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    available: false,
    recommended: false,
  },
];

export function isAvailableAiProvider(
  provider: unknown,
): provider is AiProviderId {
  return AI_PROVIDERS.some(
    (candidate) => candidate.id === provider && candidate.available,
  );
}
