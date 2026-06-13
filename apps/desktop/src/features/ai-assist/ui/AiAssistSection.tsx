import { useEffect, useRef, useState } from "react";

import type { Strings } from "@/shared/i18n";

import type { AiAssistController } from "../model/types";

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
  const [copied, setCopied] = useState(false);
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

  const available = state.status.available;
  const configured = state.status.configured;

  async function copySetupLink() {
    try {
      await navigator.clipboard.writeText(AI_STUDIO_URL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--lin-border)] pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--lin-text)]">
            {strings.ai.fallbackLabel}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--lin-text-dim)]">
            {available ? strings.ai.fallbackHint : strings.ai.unavailable}
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

      <section className="grid gap-3" aria-labelledby="gemini-provider-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--lin-text-dim)]">
              {strings.ai.providerLabel}
            </p>
            <h2
              className="text-sm font-medium text-[var(--lin-text)]"
              id="gemini-provider-title"
            >
              Google Gemini
            </h2>
          </div>
          <span
            className={`rounded-full border px-2 py-1 text-[11px] ${
              configured
                ? "border-emerald-500/40 text-emerald-400"
                : "border-[var(--lin-border)] text-[var(--lin-text-mute)]"
            }`}
          >
            {configured ? strings.ai.configured : strings.ai.notConfigured}
          </span>
        </div>

        <label className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-xs text-[var(--lin-text-dim)]">
            {strings.ai.apiKeyLabel}
            <button
              aria-expanded={guideOpen}
              aria-label={guideOpen ? strings.ai.hideSetup : strings.ai.showSetup}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--lin-border)] text-[10px] text-[var(--lin-text-dim)] hover:border-[var(--lin-text-dim)] hover:text-[var(--lin-text)]"
              onClick={(event) => {
                event.preventDefault();
                setGuideOpen((open) => !open);
              }}
              title={strings.ai.setupTitle}
              type="button"
            >
              ?
            </button>
          </span>
          <input
            autoComplete="off"
            className="h-10 min-w-0 rounded-md border border-[var(--lin-border)] bg-[var(--lin-bg)] px-3 text-sm text-[var(--lin-text)] outline-none focus:border-[var(--lin-text-dim)]"
            disabled={!available || state.isConfiguring}
            onChange={(event) => {
              setApiKey(event.target.value);
              controller.clearError();
            }}
            placeholder={configured ? strings.ai.keyStored : strings.ai.apiKeyPlaceholder}
            type="password"
            value={apiKey}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md bg-[var(--lin-accent)] px-3 py-2 text-xs font-medium text-[var(--lin-bg)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!available || !apiKey.trim() || state.isConfiguring}
            onClick={async () => {
              const saved = await controller.saveApiKey(apiKey);
              if (saved) {
                setApiKey("");
                setGuideOpen(false);
              }
            }}
            type="button"
          >
            {state.isConfiguring ? strings.ai.testing : strings.ai.saveAndTest}
          </button>
          {configured ? (
            <button
              className="rounded-md border border-[var(--lin-border)] px-3 py-2 text-xs text-[var(--lin-danger)] disabled:opacity-50"
              disabled={state.isConfiguring}
              onClick={() => void controller.removeApiKey()}
              type="button"
            >
              {strings.ai.removeKey}
            </button>
          ) : null}
          <button
            className="ml-auto text-xs text-[var(--lin-text-dim)] underline decoration-[var(--lin-border)] underline-offset-4 hover:text-[var(--lin-text)]"
            onClick={() => setGuideOpen((open) => !open)}
            type="button"
          >
            {guideOpen ? strings.ai.hideSetup : strings.ai.showSetup}
          </button>
        </div>

        {state.error ? (
          <p className="text-xs text-[var(--lin-danger)]">
            {aiErrorText(strings, state.error.code)}
          </p>
        ) : null}

        {guideOpen ? (
          <div className="rounded-lg border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium text-[var(--lin-text)]">
                  {strings.ai.setupTitle}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--lin-text-dim)]">
                  {strings.ai.setupGuide}
                </p>
              </div>
              <button
                className="shrink-0 rounded-md border border-[var(--lin-border)] px-2.5 py-1.5 text-xs text-[var(--lin-text-dim)] hover:border-[var(--lin-text-dim)] hover:text-[var(--lin-text)]"
                onClick={() => void copySetupLink()}
                type="button"
              >
                {copied ? strings.ai.copied : strings.ai.copyLink}
              </button>
            </div>
            <ol className="mt-3 grid gap-2">
              {strings.ai.setupSteps.map((step, index) => (
                <li
                  className="grid grid-cols-[20px_minmax(0,1fr)] gap-2 text-xs leading-5 text-[var(--lin-text-dim)]"
                  key={step}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--lin-bg)] text-[10px] font-medium text-[var(--lin-text)]">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 border-t border-[var(--lin-border)] pt-2 text-[11px] leading-4 text-[var(--lin-text-mute)]">
              {strings.ai.setupNote}
            </p>
          </div>
        ) : null}
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
