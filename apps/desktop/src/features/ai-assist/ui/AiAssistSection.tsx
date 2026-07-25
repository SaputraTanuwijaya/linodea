import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

import type { Strings } from "@/shared/i18n";
import { isTauriRuntime } from "@/shared/lib";

import { AI_PROVIDERS } from "../model/providers";
import type { AiAssistController, AiProviderId } from "../model/types";

const AI_STUDIO_URL = "https://aistudio.google.com/apikey";

export function AiAssistSection({
  controller,
  strings,
}: {
  controller: AiAssistController;
  strings: Strings;
}) {
  const { state } = controller;
  const [apiKey, setApiKey] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(!state.status.configured);
  const [guideOpen, setGuideOpen] = useState(!state.status.configured);
  const attemptedRefresh = useRef(false);

  useEffect(() => {
    if (
      !attemptedRefresh.current &&
      state.status.configured &&
      state.models.length === 0
    ) {
      attemptedRefresh.current = true;
      void controller.refreshModels();
    }
  }, [controller, state.models.length, state.status.configured]);

  useEffect(() => {
    setConnectionOpen(!state.status.configured);
    setGuideOpen(!state.status.configured);
  }, [state.status.configured]);

  const available = state.status.available;
  const configured = state.status.configured;

  async function openAiStudio(event: MouseEvent<HTMLAnchorElement>) {
    if (!isTauriRuntime()) return;
    event.preventDefault();
    await openUrl(AI_STUDIO_URL);
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--lin-border)] pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--lin-text)]">
            {strings.ai.fallbackLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--lin-text-dim)]">
            {!available
              ? strings.ai.unavailable
              : configured
                ? strings.ai.fallbackHint
                : strings.ai.fallbackNeedsKey}
          </p>
        </div>
        <button
          aria-checked={state.config.enabled}
          aria-label={strings.ai.fallbackLabel}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--lin-border)] transition-colors ${
            state.config.enabled
              ? "bg-[var(--lin-accent)]"
              : "bg-[var(--lin-text-mute)]"
          } ${available && configured ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
          disabled={!available || !configured}
          onClick={() => controller.updateConfig({ enabled: !state.config.enabled })}
          role="switch"
          type="button"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--lin-bg)] shadow-sm transition-transform ${
              state.config.enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <section className="grid gap-2" aria-labelledby="ai-provider-label">
        <div className="flex items-center justify-between gap-3">
          <label
            className="text-xs font-medium text-[var(--lin-text)]"
            htmlFor="ai-provider"
            id="ai-provider-label"
          >
            {strings.ai.providerLabel}
          </label>
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--lin-text-dim)]">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                configured ? "bg-emerald-400" : "bg-[var(--lin-text-mute)]"
              }`}
            />
            {configured ? strings.ai.configured : strings.ai.notConfigured}
          </span>
        </div>
        <select
          className="h-10 min-w-0 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg)] px-2.5 text-sm text-[var(--lin-text)] outline-none focus:border-[var(--lin-text-dim)]"
          id="ai-provider"
          onChange={(event) =>
            controller.updateConfig({ provider: event.target.value as AiProviderId })
          }
          value={state.config.provider}
        >
          {AI_PROVIDERS.map((provider) => (
            <option disabled={!provider.available} key={provider.id} value={provider.id}>
              {provider.name}
              {provider.recommended ? ` - ${strings.ai.recommended}` : ""}
              {!provider.available ? ` - ${strings.ai.comingLater}` : ""}
            </option>
          ))}
        </select>
        <p className="text-xs leading-5 text-[var(--lin-text-dim)]">
          {strings.ai.providerHint}
        </p>
      </section>

      <section className="grid gap-3 border-t border-[var(--lin-border)] pt-4">
        {configured && !connectionOpen ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs leading-5 text-[var(--lin-text-dim)]">
              {strings.ai.connectionStored}
            </p>
            <button
              className="shrink-0 text-xs text-[var(--lin-text-dim)] underline decoration-[var(--lin-border)] underline-offset-4 hover:text-[var(--lin-text)]"
              onClick={() => setConnectionOpen(true)}
              type="button"
            >
              {strings.ai.manageConnection}
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <label
                className="text-xs font-medium text-[var(--lin-text)]"
                htmlFor="ai-api-key"
              >
                {strings.ai.apiKeyLabel}
              </label>
              {configured ? (
                <button
                  className="text-xs text-[var(--lin-text-dim)] underline decoration-[var(--lin-border)] underline-offset-4 hover:text-[var(--lin-text)]"
                  onClick={() => setConnectionOpen(false)}
                  type="button"
                >
                  {strings.ai.hideConnection}
                </button>
              ) : null}
            </div>
            <input
              autoComplete="off"
              className="h-10 min-w-0 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg)] px-3 text-sm text-[var(--lin-text)] outline-none focus:border-[var(--lin-text-dim)]"
              disabled={!available || state.isConfiguring}
              id="ai-api-key"
              onChange={(event) => {
                setApiKey(event.target.value);
                controller.clearError();
              }}
              placeholder={configured ? strings.ai.keyStored : strings.ai.apiKeyPlaceholder}
              type="password"
              value={apiKey}
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="rounded-md bg-[var(--lin-accent)] px-3 py-2 text-xs font-medium text-[var(--lin-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!available || !apiKey.trim() || state.isConfiguring}
                onClick={async () => {
                  const saved = await controller.saveApiKey(apiKey);
                  if (saved) setApiKey("");
                }}
                type="button"
              >
                {state.isConfiguring ? strings.ai.testing : strings.ai.saveAndTest}
              </button>
              <button
                className="text-xs text-[var(--lin-text-dim)] underline decoration-[var(--lin-border)] underline-offset-4 hover:text-[var(--lin-text)]"
                onClick={() => setGuideOpen((open) => !open)}
                type="button"
              >
                {guideOpen ? strings.ai.hideSetup : strings.ai.showSetup}
              </button>
              {configured ? (
                <button
                  className="ml-auto text-xs text-[var(--lin-danger)] hover:underline"
                  disabled={state.isConfiguring}
                  onClick={() => void controller.removeApiKey()}
                  type="button"
                >
                  {strings.ai.removeKey}
                </button>
              ) : null}
            </div>

            {state.error ? (
              <p className="text-xs text-[var(--lin-danger)]">
                {aiErrorText(strings, state.error.code)}
              </p>
            ) : null}

            {guideOpen ? (
              <div className="border-l-2 border-[var(--lin-border)] pl-3">
                <h3 className="text-sm font-medium text-[var(--lin-text)]">
                  {strings.ai.setupTitle}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--lin-text-dim)]">
                  {strings.ai.setupGuide}
                </p>
                <a
                  className="mt-1 inline-block break-all text-xs text-[var(--lin-text)] underline decoration-[var(--lin-text-dim)] underline-offset-4 hover:text-[var(--lin-accent)]"
                  href={AI_STUDIO_URL}
                  onClick={(event) => void openAiStudio(event)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {AI_STUDIO_URL}
                </a>
                <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-xs leading-5 text-[var(--lin-text-dim)]">
                  {strings.ai.setupSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p className="mt-3 border-t border-[var(--lin-border)] pt-2 text-[11px] leading-4 text-[var(--lin-text-mute)]">
                  {strings.ai.setupNote}
                </p>
              </div>
            ) : null}
          </>
        )}
      </section>

      {configured ? (
        <section className="grid gap-2 border-t border-[var(--lin-border)] pt-4">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-medium text-[var(--lin-text)]" htmlFor="ai-model">
              {strings.ai.modelLabel}
            </label>
            <button
              className="text-xs text-[var(--lin-text-dim)] hover:text-[var(--lin-text)] disabled:opacity-50"
              disabled={state.isConfiguring}
              onClick={() => void controller.refreshModels()}
              type="button"
            >
              {strings.ai.refreshModels}
            </button>
          </div>
          <select
            className="h-10 min-w-0 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg)] px-2.5 text-sm text-[var(--lin-text)] outline-none"
            id="ai-model"
            onChange={(event) => controller.updateConfig({ model: event.target.value })}
            value={state.config.model ?? ""}
          >
            {state.models.length === 0 && state.config.model ? (
              <option value={state.config.model}>{state.config.model}</option>
            ) : null}
            {state.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}{model.recommended ? ` - ${strings.ai.fast}` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs leading-5 text-[var(--lin-text-dim)]">
            {strings.ai.fastHint}
          </p>
        </section>
      ) : null}

      <p className="border-t border-[var(--lin-border)] pt-4 text-xs leading-5 text-[var(--lin-text-mute)]">
        {strings.ai.privacy}
      </p>
    </div>
  );
}

export function aiErrorText(strings: Strings, code: string): string {
  switch (code) {
    case "invalid_key":
      return strings.ai.errors.invalidKey;
    case "quota_exceeded":
      return strings.ai.errors.quota;
    case "timeout":
      return strings.ai.errors.timeout;
    case "network":
      return strings.ai.errors.network;
    case "unsupported_model":
      return strings.ai.errors.model;
    case "unavailable":
      return strings.ai.unavailable;
    default:
      return strings.ai.errors.generic;
  }
}
