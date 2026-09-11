/**
 * Alert presence state hook.
 *
 * Initial value comes from localStorage. Setter persists then updates state.
 */

import { useCallback, useState } from "react";

import {
  getStoredAlertPresence,
  persistAlertPresence,
  type AlertPresence,
} from "./alerts";

export function useAlertPresence() {
  const [presence, setPresenceState] = useState<AlertPresence>(() =>
    getStoredAlertPresence(),
  );

  const setPresence = useCallback((next: AlertPresence) => {
    persistAlertPresence(next);
    setPresenceState(next);
  }, []);

  return [presence, setPresence] as const;
}
