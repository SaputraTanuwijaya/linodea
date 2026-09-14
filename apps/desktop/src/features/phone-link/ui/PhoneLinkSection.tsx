/**
 * Phone link section UI.
 *
 * The addresses are the point of this panel. Whether two devices on the same
 * Wi-Fi can actually talk to each other is an invisible property of the network
 * — plenty of campus and cafe networks block it — so the panel hands over a URL
 * to try from the phone's browser and lets the answer be observed rather than
 * assumed.
 *
 * Pairing leads with a QR because the alternative was reading an IP address off
 * one screen and typing it into another, which went wrong the first time a real
 * person tried it (`.255` for `.155`). The typed code stays underneath as the
 * fallback: a QR is useless on a phone whose camera app will not open a plain
 * `http://` link, and that is not knowable in advance.
 */

import type { Strings } from "@/shared/i18n";

import {
  healthUrl,
  pairUrl,
  type AddressProbe,
  type PairingState,
  type PhoneLinkStatus,
  type QrImage,
} from "../model/phoneLink";
import { QrCode } from "./QrCode";

export function PhoneLinkSection({
  busy,
  enabled,
  error,
  onBeginPairing,
  onCancelPairing,
  onCheckAddresses,
  onEnabledChange,
  onForgetDevice,
  onSelectAddress,
  pairing,
  probes,
  probing,
  qr,
  selectedAddress,
  status,
  strings,
}: {
  busy: boolean;
  enabled: boolean;
  error: string | null;
  onBeginPairing: () => void;
  onCancelPairing: () => void;
  onCheckAddresses: () => void;
  onEnabledChange: (next: boolean) => void;
  onForgetDevice: (id: string) => void;
  onSelectAddress: (address: string) => void;
  pairing: PairingState;
  probes: AddressProbe[];
  probing: boolean;
  qr: QrImage | null;
  selectedAddress: string | undefined;
  status: PhoneLinkStatus;
  strings: Strings;
}) {
  const copy = strings.phoneLink;
  // `undefined` means "not checked yet", which is a third state and must not
  // render as a failure — the panel would otherwise accuse a working address of
  // being dead for the second before the first probe returns.
  const verdict = (address: string): boolean | undefined =>
    probes.find((probe) => probe.address === address)?.reachable;

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm text-[var(--lin-text)]">{copy.toggleLabel}</p>
          <p className="mt-0.5 text-xs leading-4 text-[var(--lin-text-mute)]">
            {copy.toggleHint}
          </p>
        </div>
        <button
          aria-checked={enabled}
          aria-label={copy.toggleLabel}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-[var(--lin-border)] transition-colors ${
            enabled ? "bg-[var(--lin-accent)]" : "bg-[var(--lin-text-mute)]"
          } ${busy ? "cursor-wait opacity-60" : "cursor-pointer"}`}
          disabled={busy}
          onClick={() => onEnabledChange(!enabled)}
          role="switch"
          type="button"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-[var(--lin-bg)] shadow-sm transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-[var(--lin-danger)] bg-[var(--lin-danger-bg)] px-3 py-2 text-xs leading-4 text-[var(--lin-text)]">
          {copy.error(error)}
        </p>
      ) : null}

      {enabled && status.running ? (
        <div className="rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-[var(--lin-text)]">
              {copy.testHeading}
            </p>
            <button
              className={`flex-none rounded-md border border-[var(--lin-border)] px-2 py-1 text-[11px] font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg)] ${
                probing ? "cursor-wait opacity-60" : ""
              }`}
              disabled={probing}
              onClick={onCheckAddresses}
              type="button"
            >
              {probing ? copy.checking : copy.checkAgain}
            </button>
          </div>
          <p className="mt-0.5 text-xs leading-4 text-[var(--lin-text-mute)]">
            {copy.testHint}
          </p>
          {status.addresses.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--lin-text-dim)]">
              {copy.noAddresses}
            </p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {status.addresses.map((address) => {
                const reachable = verdict(address);
                return (
                  <li
                    className="flex items-center justify-between gap-2 rounded-md bg-[var(--lin-bg)] px-2 py-1.5"
                    key={address}
                  >
                    <span className="select-all truncate font-mono text-xs text-[var(--lin-text)]">
                      {healthUrl(address, status.port)}
                    </span>
                    {reachable === undefined ? null : (
                      <span
                        className={`flex-none text-[11px] font-medium ${
                          reachable
                            ? "text-[var(--lin-accent)]"
                            : "text-[var(--lin-danger)]"
                        }`}
                      >
                        {reachable ? copy.addressAnswers : copy.addressNoAnswer}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {probes.length > 0 ? (
            <p className="mt-2 text-xs leading-4 text-[var(--lin-text-dim)]">
              {copy.probeNote}
            </p>
          ) : null}
          <p className="mt-2 text-xs leading-4 text-[var(--lin-text-mute)]">
            {copy.firewallNote}
          </p>
        </div>
      ) : null}

      {enabled && status.running ? (
        <div className="rounded-xl border border-[var(--lin-border)] bg-[var(--lin-bg-hover)] px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--lin-text)]">
            {copy.pairHeading}
          </p>

          {pairing.code ? (
            <>
              {qr && selectedAddress ? (
                <>
                  <div className="mt-2 flex justify-center">
                    <QrCode image={qr} label={copy.qrLabel} />
                  </div>
                  <p className="mt-2 text-xs leading-4 text-[var(--lin-text-mute)]">
                    {copy.pairScanHint}
                  </p>

                  {/* Only worth offering when there is genuinely something to
                      switch to. One address means no choice to make. */}
                  {status.addresses.length > 1 ? (
                    <>
                      <p className="mt-2 text-[11px] leading-4 text-[var(--lin-text-dim)]">
                        {copy.addressPick}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {status.addresses.map((address) => {
                          const reachable = verdict(address);
                          const active = address === selectedAddress;
                          return (
                            <button
                              className={`rounded-md border px-2 py-1 font-mono text-[11px] transition ${
                                active
                                  ? "border-[var(--lin-accent)] text-[var(--lin-text)]"
                                  : "border-[var(--lin-border)] text-[var(--lin-text-mute)] hover:bg-[var(--lin-bg)]"
                              }`}
                              key={address}
                              onClick={() => onSelectAddress(address)}
                              type="button"
                            >
                              {address}
                              {reachable === false ? (
                                <span className="ml-1 text-[var(--lin-danger)]">
                                  &times;
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}

                  <p className="mt-2 border-t border-[var(--lin-border)] pt-2 text-xs leading-4 text-[var(--lin-text-mute)]">
                    {copy.pairTypeFallback(pairUrl(selectedAddress, status.port))}
                  </p>
                </>
              ) : (
                <p className="mt-0.5 text-xs leading-4 text-[var(--lin-text-mute)]">
                  {selectedAddress
                    ? copy.pairInstructions(pairUrl(selectedAddress, status.port))
                    : copy.noAddresses}
                </p>
              )}

              {/* Wide tracking because this is read off one screen and typed
                  into another — the gaps are what stop characters merging. */}
              <p className="mt-2 rounded-md bg-[var(--lin-bg)] px-3 py-3 text-center font-mono text-2xl font-semibold tracking-[0.3em] text-[var(--lin-text)]">
                {pairing.code}
              </p>
              <button
                className="mt-2 w-full rounded-md border border-[var(--lin-border)] px-3 py-1.5 text-xs font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg)]"
                onClick={onCancelPairing}
                type="button"
              >
                {copy.pairCancel}
              </button>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-xs leading-4 text-[var(--lin-text-mute)]">
                {copy.pairHint}
              </p>
              <button
                className="mt-2 w-full rounded-md bg-[var(--lin-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--lin-bg)] transition hover:opacity-90"
                onClick={onBeginPairing}
                type="button"
              >
                {copy.pairStart}
              </button>
            </>
          )}

          {pairing.devices.length > 0 ? (
            <ul className="mt-3 grid gap-1 border-t border-[var(--lin-border)] pt-2.5">
              {pairing.devices.map((device) => (
                <li
                  className="flex items-center justify-between gap-2 rounded-md bg-[var(--lin-bg)] px-2.5 py-2"
                  key={device.id}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-[var(--lin-text)]">
                      {device.name}
                    </p>
                    <p className="truncate text-[11px] text-[var(--lin-text-mute)]">
                      {device.lastSeenMs
                        ? copy.lastSeen(new Date(device.lastSeenMs).toLocaleString())
                        : copy.neverSeen}
                    </p>
                  </div>
                  <button
                    className="flex-none rounded-md border border-[var(--lin-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--lin-text)] transition hover:bg-[var(--lin-bg-hover)]"
                    onClick={() => onForgetDevice(device.id)}
                    type="button"
                  >
                    {copy.forget}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
