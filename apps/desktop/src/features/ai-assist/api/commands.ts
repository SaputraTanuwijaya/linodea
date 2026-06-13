import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "@/shared/lib";

import type {
  AiCommandError,
  AiModel,
  AiNormalizationRequest,
  AiNormalizationResult,
  AiStatus,
  SaveKeyResult,
} from "../model/types";

export async function readAiStatus(): Promise<AiStatus> {
  if (!isTauriRuntime()) return { available: false, configured: false };
  return invoke<AiStatus>("get_ai_assist_status").catch(throwAiError);
}

export async function saveAndTestAiApiKey(apiKey: string): Promise<SaveKeyResult> {
  if (!isTauriRuntime()) throw unavailableError();
  return invoke<SaveKeyResult>("save_and_test_ai_api_key", { apiKey }).catch(
    throwAiError,
  );
}

export async function deleteAiApiKey(): Promise<AiStatus> {
  if (!isTauriRuntime()) throw unavailableError();
  return invoke<AiStatus>("delete_ai_api_key").catch(throwAiError);
}

export async function listAiModels(): Promise<AiModel[]> {
  if (!isTauriRuntime()) throw unavailableError();
  return invoke<AiModel[]>("list_ai_models").catch(throwAiError);
}

export async function normalizeReminderWithAi(
  request: AiNormalizationRequest,
): Promise<AiNormalizationResult> {
  if (!isTauriRuntime()) throw unavailableError();
  return invoke<AiNormalizationResult>("normalize_reminder_with_ai", {
    request,
  }).catch(throwAiError);
}

function throwAiError(error: unknown): never {
  throw asAiCommandError(error);
}

export function asAiCommandError(error: unknown): AiCommandError {
  if (isAiCommandError(error)) return error;
  return {
    code: "provider_error",
    message: typeof error === "string" ? error : "AI Assist failed.",
  };
}

function isAiCommandError(error: unknown): error is AiCommandError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function unavailableError(): AiCommandError {
  return {
    code: "unavailable",
    message: "AI Assist is available only in the desktop app.",
  };
}
