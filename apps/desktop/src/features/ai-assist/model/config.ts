import type { AiAssistConfig, AiModel } from "./types";

const STORAGE_KEY = "linodea.aiAssist.v1";

export const DEFAULT_AI_ASSIST_CONFIG: AiAssistConfig = {
  enabled: false,
  provider: "gemini",
  model: null,
  activation: "fallback",
};

export function readAiAssistConfig(): AiAssistConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_AI_ASSIST_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiAssistConfig>;
    return {
      enabled: parsed.enabled === true,
      provider: "gemini",
      model: typeof parsed.model === "string" ? parsed.model : null,
      activation: "fallback",
    };
  } catch {
    return DEFAULT_AI_ASSIST_CONFIG;
  }
}

export function writeAiAssistConfig(config: AiAssistConfig): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function chooseAiModel(
  models: AiModel[],
  current: string | null,
): string | null {
  if (current && models.some((model) => model.id === current)) return current;
  return models.find((model) => model.recommended)?.id ?? models[0]?.id ?? null;
}
