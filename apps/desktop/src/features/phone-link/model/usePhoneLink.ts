/**
 * Phone link state.
 *
 * Owns the preference and keeps the Rust-side server in sync with it. The
 * server is started on mount when the preference is on, because the app runs
 * always-on in the tray and that is precisely when a phone would try to reach
 * it — waiting for someone to open Settings would mean the link only worked
 * while the window was up.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isTauriRuntime } from "@/shared/lib";

import {
  IDLE_PAIRING,
  IDLE_STATUS,
  beginPairing,
  cancelPairing,
  encodeQr,
  forgetDevice,
  getStoredPhoneLinkEnabled,
  pairUrl,
  persistPhoneLinkEnabled,
  preferredAddress,
  probeAddresses,
  readStatus,
  readPairingState,
  startServer,
  stopServer,
  type AddressProbe,
  type PairingState,
  type PhoneLinkStatus,
  type QrImage,
} from "./phoneLink";

export interface PhoneLinkController {
  enabled: boolean;
  status: PhoneLinkStatus;
  /** Set when the server could not bind — surfaced rather than swallowed. */
  error: string | null;
  busy: boolean;
  setEnabled: (next: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  /** Open invitation + the devices already paired. */
  pairing: PairingState;
  beginPairing: () => Promise<void>;
  cancelPairing: () => Promise<void>;
  forgetDevice: (id: string) => Promise<void>;
  /** Per-address reachability, empty until the first check has run. */
  probes: AddressProbe[];
  probing: boolean;
  checkAddresses: () => Promise<void>;
  /** The address the QR points at. */
  selectedAddress: string | undefined;
  selectAddress: (address: string) => void;
  /** The pairing link as QR path data; null unless an invitation is open. */
  qr: QrImage | null;
}

export function usePhoneLink(): PhoneLinkController {
  const [enabled, setEnabledState] = useState(getStoredPhoneLinkEnabled);
  const [status, setStatus] = useState<PhoneLinkStatus>(IDLE_STATUS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<PairingState>(IDLE_PAIRING);
  const [probes, setProbes] = useState<AddressProbe[]>([]);
  const [probing, setProbing] = useState(false);
  const [addressOverride, setAddressOverride] = useState<string | null>(null);
  const [qr, setQr] = useState<QrImage | null>(null);
  const started = useRef(false);

  const check = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setProbing(true);
    try {
      setProbes(await probeAddresses());
    } catch (cause) {
      // A failed check leaves the old verdicts rather than claiming every
      // address is dead — stale information beats wrong information here.
      setError(String(cause));
    } finally {
      setProbing(false);
    }
  }, []);

  // Start once on mount if the preference says so. Guarded by a ref rather than
  // the effect's deps because `start` is idempotent on the Rust side but a
  // double-invoke would still race two status writes.
  useEffect(() => {
    if (!isTauriRuntime() || started.current) return;
    started.current = true;
    void (async () => {
      try {
        const next = enabled ? await startServer() : await readStatus();
        setStatus(next);
        setPairing(await readPairingState());
        if (next.running) await check();
      } catch (cause) {
        setError(String(cause));
      }
    })();
  }, [enabled, check]);

  const setEnabled = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      persistPhoneLinkEnabled(next);
      setEnabledState(next);
      try {
        setStatus(next ? await startServer() : await stopServer());
        if (next) {
          await check();
        } else {
          setProbes([]);
        }
      } catch (cause) {
        // Binding can fail legitimately — every candidate port taken, or a
        // policy blocking the socket. Leave the toggle off rather than claiming
        // a link that isn't listening.
        setError(String(cause));
        persistPhoneLinkEnabled(false);
        setEnabledState(false);
        setStatus(IDLE_STATUS);
        setProbes([]);
      } finally {
        setBusy(false);
      }
    },
    [check],
  );

  const refresh = useCallback(async () => {
    try {
      setStatus(await readStatus());
      setPairing(await readPairingState());
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  // A code expires on its own after five minutes, so the panel polls while one
  // is open rather than showing a code that has quietly stopped working.
  useEffect(() => {
    if (!pairing.code) return;
    const id = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(id);
  }, [pairing.code, refresh]);

  // An override only survives while the address is still on the machine —
  // unplugging Ethernet or joining a different network must not leave the QR
  // pointing at an address that no longer exists.
  const selectedAddress = useMemo(() => {
    if (addressOverride && status.addresses.includes(addressOverride)) {
      return addressOverride;
    }
    return preferredAddress(status.addresses, probes);
  }, [addressOverride, probes, status.addresses]);

  // Re-encode whenever the link changes. Cheap, and it keeps the QR and the URL
  // printed under it from ever disagreeing about where they point.
  useEffect(() => {
    if (!pairing.code || !selectedAddress || !status.port) {
      setQr(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const image = await encodeQr(
          pairUrl(selectedAddress, status.port, pairing.code ?? undefined),
        );
        if (live) setQr(image);
      } catch (cause) {
        // The code still shows, so pairing stays possible by hand.
        if (live) setQr(null);
        setError(String(cause));
      }
    })();
    return () => {
      live = false;
    };
  }, [pairing.code, selectedAddress, status.port]);

  const begin = useCallback(async () => {
    try {
      // Re-check first: this is the moment an address gets committed to a QR,
      // and the machine may have changed networks since the panel was opened.
      await check();
      setPairing(await beginPairing());
    } catch (cause) {
      setError(String(cause));
    }
  }, [check]);

  const cancel = useCallback(async () => {
    try {
      setPairing(await cancelPairing());
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  const forget = useCallback(async (id: string) => {
    try {
      setPairing(await forgetDevice(id));
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  return {
    enabled,
    status,
    error,
    busy,
    setEnabled,
    refresh,
    pairing,
    beginPairing: begin,
    cancelPairing: cancel,
    forgetDevice: forget,
    probes,
    probing,
    checkAddresses: check,
    selectedAddress,
    selectAddress: setAddressOverride,
    qr,
  };
}
