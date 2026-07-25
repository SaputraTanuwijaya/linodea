/**
 * Support section UI.
 *
 * Renders inside a SettingsSection wrapper — no title, no hint paragraph
 * (those live on the section wrapper). Three external links: two donations
 * (Ko-fi, Saweria) and a feedback form.
 *
 * The URLs are not live yet. A link stays disabled ("coming soon") until its
 * constant in `shared/config/links.ts` holds a real URL, so the section can
 * ship without ever pointing at a dead page — filling in the URL later is the
 * whole change. External navigation uses `openUrl` (same pattern as
 * AiAssistSection), which only works in the Tauri runtime.
 */

import { openUrl } from "@tauri-apps/plugin-opener";

import { FEEDBACK_FORM_URL, KO_FI_URL, SAWERIA_URL } from "@/shared/config";
import type { Strings } from "@/shared/i18n";
import { isTauriRuntime } from "@/shared/lib";

export function SupportSection({ strings }: { strings: Strings }) {
  async function open(url: string) {
    if (!url || !isTauriRuntime()) return;
    await openUrl(url);
  }

  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <p className="text-xs leading-5 text-[var(--lin-text-dim)]">
          {strings.support.intro}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <LinkButton
            label={strings.support.koFi}
            onOpen={() => void open(KO_FI_URL)}
            soonLabel={strings.support.comingSoon}
            url={KO_FI_URL}
          />
          <LinkButton
            label={strings.support.saweria}
            onOpen={() => void open(SAWERIA_URL)}
            soonLabel={strings.support.comingSoon}
            url={SAWERIA_URL}
          />
        </div>
      </section>

      <section className="grid gap-3 border-t border-[var(--lin-border)] pt-4">
        <div>
          <p className="text-sm font-medium text-[var(--lin-text)]">
            {strings.support.feedbackTitle}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--lin-text-dim)]">
            {strings.support.feedbackHint}
          </p>
        </div>
        <div>
          <LinkButton
            accent
            label={strings.support.feedbackButton}
            onOpen={() => void open(FEEDBACK_FORM_URL)}
            soonLabel={strings.support.comingSoon}
            url={FEEDBACK_FORM_URL}
          />
        </div>
      </section>
    </div>
  );
}

/**
 * External-link button. Disabled with a "coming soon" hint until its URL is
 * filled in, so a not-yet-created page can never be opened.
 */
function LinkButton({
  accent = false,
  label,
  onOpen,
  soonLabel,
  url,
}: {
  accent?: boolean;
  label: string;
  onOpen: () => void;
  soonLabel: string;
  url: string;
}) {
  const ready = url.length > 0;
  const style = accent
    ? "bg-[var(--lin-accent)] text-[var(--lin-bg)]"
    : "border border-[var(--lin-border)] text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)]";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={`rounded-md px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
        disabled={!ready}
        onClick={onOpen}
        type="button"
      >
        {label}
      </button>
      {ready ? null : (
        <span className="text-[11px] leading-4 text-[var(--lin-text-mute)]">
          {soonLabel}
        </span>
      )}
    </span>
  );
}
