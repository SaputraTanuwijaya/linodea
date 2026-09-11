/**
 * Public surface for the alerts feature.
 *
 * `alertProfile` and `getStoredAlertPresence` are exposed for two consumers
 * outside React's settings tree: the notification driver
 * (entities/reminder/lib/notifications.ts), which stamps the presence onto each
 * alert payload, and the alert window itself, which renders from it.
 */

export {
  ALERT_PRESENCE_IDS,
  DEFAULT_ALERT_PRESENCE,
  alertProfile,
  getStoredAlertPresence,
  type AlertPresence,
  type AlertProfile,
} from "./model/alerts";
export { useAlertPresence } from "./model/useAlertPresence";
export { AlertsSection } from "./ui/AlertsSection";
export { alertsSettingsSection } from "./settingsSection";
