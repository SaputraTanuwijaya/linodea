import type { SettingsBundle, SettingsSectionDescriptor } from "@/shared/settings";

import { AiAssistSection } from "./ui/AiAssistSection";

function AiAssistSettingsContent({ bundle }: { bundle: SettingsBundle }) {
  return <AiAssistSection controller={bundle.aiAssist} strings={bundle.strings} />;
}

export const aiAssistSettingsSection: SettingsSectionDescriptor = {
  id: "ai-assist",
  order: 50,
  title: (strings) => strings.settings.ai.title,
  hint: (strings) => strings.settings.ai.hint,
  Component: AiAssistSettingsContent,
};
