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
import type { ReactNode } from "react";

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
            icon={<LogoChip src="/brand/kofi.svg" />}
            label={strings.support.koFi}
            onOpen={() => void open(KO_FI_URL)}
            soonLabel={strings.support.comingSoon}
            url={KO_FI_URL}
          />
          <LinkButton
            icon={<LogoChip fill src="/brand/Saweria_512px.png" />}
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
  icon,
  label,
  onOpen,
  soonLabel,
  url,
}: {
  accent?: boolean;
  icon?: ReactNode;
  label: string;
  onOpen: () => void;
  soonLabel: string;
  url: string;
}) {
  const ready = url.length > 0;
  const style = accent
    ? "bg-[var(--lin-accent)] text-[var(--lin-bg)]"
    : "border border-[var(--lin-border)] text-[var(--lin-text)] transition hover:border-[var(--lin-text-dim)] hover:bg-[var(--lin-bg-hover)]";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
        disabled={!ready}
        onClick={onOpen}
        type="button"
      >
        {icon}
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

/**
 * A brand logo in a small white "coin" chip. The chip gives the logo a
 * consistent light backing so the Ko-fi cup (dark outline on transparent) reads
 * on the dark theme, while Saweria (a self-contained orange circle mark) fills
 * the chip edge-to-edge. `fill` = cover the chip (already-circular marks);
 * otherwise the logo is padded inside (transparent marks like the Ko-fi cup).
 */
function LogoChip({ src, fill = false }: { src: string; fill?: boolean }) {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/10">
      <img
        alt=""
        aria-hidden="true"
        className={
          fill ? "h-full w-full object-cover" : "h-3.5 w-3.5 object-contain"
        }
        src={src}
      />
    </span>
  );
}
