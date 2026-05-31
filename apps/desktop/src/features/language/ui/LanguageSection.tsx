/**
 * Language picker section.
 *
 * Renders the grid of language cards. LanguageCard is internal — only
 * LanguageSection is exported.
 */

import { LANGUAGES, type LanguageDefinition, type LanguageId } from "../model/language";

export function LanguageSection({
  activeLanguage,
  onLanguageChange,
}: {
  activeLanguage: LanguageId;
  onLanguageChange: (next: LanguageId) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {LANGUAGES.map((lang) => (
        <LanguageCard
          isActive={lang.id === activeLanguage}
          key={lang.id}
          language={lang}
          onSelect={() => onLanguageChange(lang.id)}
        />
      ))}
    </div>
  );
}

function LanguageCard({
  isActive,
  language,
  onSelect,
}: {
  isActive: boolean;
  language: LanguageDefinition;
  onSelect: () => void;
}) {
  const ring = isActive
    ? "ring-2 ring-[var(--lin-text)]"
    : "ring-1 ring-[var(--lin-border)] hover:ring-[var(--lin-text-dim)]";

  return (
    <button
      aria-pressed={isActive}
      className={`flex items-center gap-3 rounded-xl bg-[var(--lin-bg-hover)] p-2.5 text-left transition ${ring}`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--lin-border)] bg-[var(--lin-bg)] text-sm font-semibold uppercase text-[var(--lin-text)]">
        {language.id}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--lin-text)]">
          {language.name}
        </p>
        <p className="truncate text-xs text-[var(--lin-text-dim)]">
          {language.sample}
        </p>
      </div>
    </button>
  );
}
