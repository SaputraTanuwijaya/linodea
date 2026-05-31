/**
 * The Settings popup mode.
 *
 * Renders each section from the registry. Adding a section is a registry
 * import + a per-feature descriptor file. SettingsPage itself does not
 * change as features arrive.
 */

import type { SettingsBundle } from "@/shared/settings";
import { SettingsSection } from "@/shared/ui";

import { SETTINGS_SECTIONS } from "./sectionRegistry";

export function SettingsPage({ bundle }: { bundle: SettingsBundle }) {
  return (
    <section className="mt-3 max-h-[600px] overflow-y-auto rounded-2xl border border-[var(--lin-border)] bg-[var(--lin-bg)] px-4 py-4 shadow-2xl backdrop-blur transition-colors">
      <div className="grid gap-5">
        {SETTINGS_SECTIONS.map((section) => (
          <SettingsSection
            hint={section.hint(bundle.strings)}
            key={section.id}
            title={section.title(bundle.strings)}
          >
            <section.Component bundle={bundle} />
          </SettingsSection>
        ))}
      </div>
    </section>
  );
}
