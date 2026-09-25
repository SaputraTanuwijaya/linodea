/**
 * Public surface for the alerts feature.
 *
 * `alertProfile` and `getStoredAlertPresence` are exposed for two consumers
 * outside React's settings tree: the notification driver
 * (entities/reminder/lib/notifications.ts), which stamps the presence onto each
 * alert payload, and the alert window itself, which renders from it.
 */

export {
  alertProfile,
  getStoredAlertPresence,
  type AlertPresence,
} from "./model/alerts";
export { useAlertPresence } from "./model/useAlertPresence";
export { alertsSettingsSection } from "./settingsSection";
