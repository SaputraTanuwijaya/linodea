/**
 * Public surface for the prealerts feature.
 *
 * `getStoredPrealerts` and `sortDescending` are exposed for the notification
 * driver (entities/reminder/lib/notifications.ts) which runs outside React
 * and reads the config directly from storage on each poll tick.
 */

export {
  getStoredPrealerts,
  MAX_PREALERTS,
  sortDescending,
  type PrealertConfig,
  type PrealertOffset,
} from "./model/prealerts";
export { usePrealerts } from "./model/usePrealerts";
export { PrealertsSection } from "./ui/PrealertsSection";
