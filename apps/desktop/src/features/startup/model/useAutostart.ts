/**
 * Autostart state hook.
 *
 * Owns the read of the OS autostart flag on mount and exposes a setter that
 * writes through the plugin and refreshes from the result.
 *
 * Returns `[state, set]` to mirror the standard React tuple shape. App.tsx
 * composes this; the hook never reaches outside the feature.
 */

import { useCallback, useEffect, useState } from "react";

import {
  readAutostart,
  writeAutostart,
  type AutostartState,
} from "./startup";

export function useAutostart() {
  const [state, setState] = useState<AutostartState>({
    available: false,
    enabled: false,
  });

  useEffect(() => {
    let mounted = true;
    void readAutostart().then((next) => {
      if (mounted) setState(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const set = useCallback(async (next: boolean) => {
    setState(await writeAutostart(next));
  }, []);

  return [state, set] as const;
}
