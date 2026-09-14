/**
 * Phone link state.
 *
 * Owns the preference and keeps the Rust-side server in sync with it. The
 * server is started on mount when the preference is on, because the app runs
 * always-on in the tray and that is precisely when a phone would try to reach
 * it — waiting for someone to open Settings would mean the link only worked
 * while the window was up.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isTauriRuntime } from "@/shared/lib";

import {
  IDLE_STATUS,
  getStoredPhoneLinkEnabled,
  persistPhoneLinkEnabled,
  readStatus,
  startServer,
  stopServer,
  type PhoneLinkStatus,
} from "./phoneLink";

export interface PhoneLinkController {
  enabled: boolean;
  status: PhoneLinkStatus;
  /** Set when the server could not bind — surfaced rather than swallowed. */
  error: string | null;
  busy: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePhoneLink(): PhoneLinkController {
  const [enabled, setEnabledState] = useState(getStoredPhoneLinkEnabled);
  const [status, setStatus] = useState<PhoneLinkStatus>(IDLE_STATUS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // Start once on mount if the preference says so. Guarded by a ref rather than
  // the effect's deps because `start` is idempotent on the Rust side but a
  // double-invoke would still race two status writes.
  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;
    void (async () => {
      try {
        setStatus(enabled ? await startServer() : await readStatus());
      } catch (cause) {
        setError(String(cause));
      }
    })();
  }, [enabled]);

  const setEnabled = useCallback(async (next: boolean) => {
    setBusy(true);
    setError(null);
    persistPhoneLinkEnabled(next);
    setEnabledState(next);
    try {
      setStatus(next ? await startServer() : await stopServer());
    } catch (cause) {
      // Binding can fail legitimately — every candidate port taken, or a
      // policy blocking the socket. Leave the toggle off rather than claiming
      // a link that isn't listening.
      setError(String(cause));
      persistPhoneLinkEnabled(false);
      setEnabledState(false);
      setStatus(IDLE_STATUS);
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await readStatus());
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  return { enabled, status, error, busy, setEnabled, refresh };
}
