/**
 * Prealert config state hook.
 *
 * Initial value comes from localStorage. Setter persists then updates state.
 */

import { useCallback, useState } from "react";

import {
  getStoredPrealerts,
  persistPrealerts,
  type PrealertConfig,
} from "./prealerts";

export function usePrealerts() {
  const [config, setConfigState] = useState<PrealertConfig>(() =>
    getStoredPrealerts(),
  );

  const setConfig = useCallback((next: PrealertConfig) => {
    persistPrealerts(next);
    setConfigState(next);
  }, []);

  return [config, setConfig] as const;
}
