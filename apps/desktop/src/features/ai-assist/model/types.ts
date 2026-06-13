import type { ParserIssueCode } from "@linodea/types";

export type AiActivationMode = "fallback";
export type AiProviderId = "gemini" | "openai" | "anthropic";

export interface AiAssistConfig {
  enabled: boolean;
  provider: AiProviderId;
  model: string | null;
  activation: AiActivationMode;
}

export interface AiStatus {
  available: boolean;
  configured: boolean;
}

export interface AiModel {
  id: string;
  displayName: string;
  description: string;
  recommended: boolean;
}

export interface AiCommandError {
  code: string;
  message: string;
}

export interface SaveKeyResult {
  status: AiStatus;
  models: AiModel[];
}

export interface AiNormalizationRequest {
  model: string;
  input: string;
  now: string;
  timezone: string;
  language: string;
  parserIssueCodes: ParserIssueCode[];
}

export interface AiNormalizationResult {
  status: "normalized" | "needs_clarification" | "unsupported";
  normalizedInput?: string;
  confidence: number;
  assumptions: string[];
  clarificationQuestion?: string;
  reason?: string;
}

export interface AiAssistState {
  config: AiAssistConfig;
  status: AiStatus;
  models: AiModel[];
  isConfiguring: boolean;
  error: AiCommandError | null;
}

export interface AiAssistController {
  state: AiAssistState;
  updateConfig: (patch: Partial<AiAssistConfig>) => void;
  saveApiKey: (apiKey: string) => Promise<boolean>;
  removeApiKey: () => Promise<void>;
  refreshModels: () => Promise<void>;
  normalize: (
    request: Omit<AiNormalizationRequest, "model">,
  ) => Promise<AiNormalizationResult>;
  clearError: () => void;
}
