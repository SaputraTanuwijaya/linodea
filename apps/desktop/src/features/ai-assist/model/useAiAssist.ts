import { useCallback, useEffect, useMemo, useState } from "react";

import {
  asAiCommandError,
  deleteAiApiKey,
  listAiModels,
  normalizeReminderWithAi,
  readAiStatus,
  saveAndTestAiApiKey,
} from "../api/commands";
import {
  chooseAiModel,
  readAiAssistConfig,
  writeAiAssistConfig,
} from "./config";
import type {
  AiAssistConfig,
  AiAssistController,
  AiAssistState,
  AiNormalizationRequest,
} from "./types";

export function useAiAssist(): AiAssistController {
  const [state, setState] = useState<AiAssistState>(() => ({
    config: readAiAssistConfig(),
    status: { available: false, configured: false },
    models: [],
    isConfiguring: false,
    error: null,
  }));

  useEffect(() => {
    let mounted = true;
    void readAiStatus()
      .then((status) => {
        if (!mounted) return;
        setState((current) => ({
          ...current,
          status,
          config: status.configured
            ? current.config
            : persistConfig({ ...current.config, enabled: false }),
        }));
      })
      .catch((error) => {
        if (!mounted) return;
        setState((current) => ({ ...current, error: asAiCommandError(error) }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  const updateConfig = useCallback((patch: Partial<AiAssistConfig>) => {
    setState((current) => {
      const config = persistConfig({ ...current.config, ...patch, provider: "gemini" });
      return { ...current, config, error: null };
    });
  }, []);

  const saveApiKey = useCallback(async (apiKey: string) => {
    setState((current) => ({ ...current, isConfiguring: true, error: null }));
    try {
      const result = await saveAndTestAiApiKey(apiKey);
      setState((current) => {
        const config = persistConfig({
          ...current.config,
          enabled: true,
          model: chooseAiModel(result.models, current.config.model),
        });
        return {
          ...current,
          config,
          status: result.status,
          models: result.models,
          isConfiguring: false,
          error: null,
        };
      });
      return true;
    } catch (error) {
      setState((current) => ({
        ...current,
        isConfiguring: false,
        error: asAiCommandError(error),
      }));
      return false;
    }
  }, []);

  const removeApiKey = useCallback(async () => {
    setState((current) => ({ ...current, isConfiguring: true, error: null }));
    try {
      const status = await deleteAiApiKey();
      setState((current) => ({
        ...current,
        status,
        models: [],
        config: persistConfig({ ...current.config, enabled: false, model: null }),
        isConfiguring: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        isConfiguring: false,
        error: asAiCommandError(error),
      }));
    }
  }, []);

  const refreshModels = useCallback(async () => {
    setState((current) => ({ ...current, isConfiguring: true, error: null }));
    try {
      const models = await listAiModels();
      setState((current) => ({
        ...current,
        models,
        config: persistConfig({
          ...current.config,
          model: chooseAiModel(models, current.config.model),
        }),
        isConfiguring: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        isConfiguring: false,
        error: asAiCommandError(error),
      }));
    }
  }, []);

  const normalize = useCallback(
    async (request: Omit<AiNormalizationRequest, "model">) => {
      const model = state.config.model;
      if (!model) {
        throw { code: "unsupported_model", message: "Select a Gemini model." };
      }
      try {
        return await normalizeReminderWithAi({ ...request, model });
      } catch (error) {
        const normalizedError = asAiCommandError(error);
        setState((current) => ({ ...current, error: normalizedError }));
        throw normalizedError;
      }
    },
    [state.config.model],
  );

  const clearError = useCallback(() => {
    setState((current) => ({ ...current, error: null }));
  }, []);

  return useMemo(
    () => ({
      state,
      updateConfig,
      saveApiKey,
      removeApiKey,
      refreshModels,
      normalize,
      clearError,
    }),
    [
      state,
      updateConfig,
      saveApiKey,
      removeApiKey,
      refreshModels,
      normalize,
      clearError,
    ],
  );
}

function persistConfig(config: AiAssistConfig): AiAssistConfig {
  writeAiAssistConfig(config);
  return config;
}
