/** Settings category navigator. Only the selected feature panel is mounted. */

import { useEffect, useMemo, useState } from "react";

import type { SettingsBundle } from "@/shared/settings";

import { SETTINGS_SECTIONS } from "./sectionRegistry";

export function SettingsPage({
  bundle,
  focusSectionId,
}: {
  bundle: SettingsBundle;
  focusSectionId?: string | null;
}) {
  const defaultSection = SETTINGS_SECTIONS[0]?.id ?? "";
  const [activeSectionId, setActiveSectionId] = useState(
    isKnownSection(focusSectionId) ? focusSectionId : defaultSection,
  );

  useEffect(() => {
    if (isKnownSection(focusSectionId)) setActiveSectionId(focusSectionId);
  }, [focusSectionId]);

  const activeSection = useMemo(
    () =>
      SETTINGS_SECTIONS.find(({ id }) => id === activeSectionId) ??
      SETTINGS_SECTIONS[0],
    [activeSectionId],
  );

  if (!activeSection) return null;

  const ActiveSection = activeSection.Component;

  return (
    <section className="mt-3 grid h-[600px] grid-cols-[156px_minmax(0,1fr)] overflow-hidden rounded-lg border border-[var(--lin-border)] bg-[var(--lin-bg)] shadow-2xl transition-colors">
      <nav
        aria-label={bundle.strings.menu.settings}
        className="border-r border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-2 py-3"
      >
        <p className="px-2 pb-2 text-xs font-semibold text-[var(--lin-text)]">
          {bundle.strings.menu.settings}
        </p>
        <div className="grid gap-1">
          {SETTINGS_SECTIONS.map((section) => {
            const active = section.id === activeSection.id;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`w-full rounded-md border-l-2 px-2.5 py-2 text-left text-xs transition ${
                  active
                    ? "border-[var(--lin-text)] bg-[var(--lin-bg)] font-medium text-[var(--lin-text)]"
                    : "border-transparent text-[var(--lin-text-dim)] hover:bg-[var(--lin-bg)] hover:text-[var(--lin-text)]"
                }`}
                key={section.id}
                onClick={() => setActiveSectionId(section.id)}
                type="button"
              >
                {section.title(bundle.strings)}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 overflow-y-auto px-5 py-5">
        <header className="border-b border-[var(--lin-border)] pb-4">
          <h1 className="text-base font-semibold text-[var(--lin-text)]">
            {activeSection.title(bundle.strings)}
          </h1>
          <p className="mt-1 max-w-[44ch] text-xs leading-5 text-[var(--lin-text-dim)]">
            {activeSection.hint(bundle.strings)}
          </p>
        </header>
        <div className="pt-4">
          <ActiveSection bundle={bundle} />
        </div>
      </div>
    </section>
  );
}

function isKnownSection(sectionId: string | null | undefined): sectionId is string {
  return Boolean(
    sectionId && SETTINGS_SECTIONS.some(({ id }) => id === sectionId),
  );
}
