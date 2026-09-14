/**
 * Phone link — the desktop half of phone delivery (see `src-tauri/src/lan.rs`).
 *
 * When enabled, the app answers on the local network so a phone that is merely
 * *near* — same Wi-Fi, or tethered to this laptop — can reach it. Never over
 * USB: a cable is a development convenience, not the transport.
 *
 * Off by default. Turning it on binds a socket reachable by every device on the
 * network and trips a Windows Firewall prompt, so it waits to be asked for.
 *
 * Persistence: localStorage key `linodea.phoneLink.v1`. Shares known-issue #7
 * with the other preferences — a cleared WebView2 cache resets it to off, which
 * for this one is the safe direction to fail.
 */

import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "@/shared/lib";

const STORAGE_KEY = "linodea.phoneLink.v1";

/** Mirrors `LanStatus` in `lan.rs`. */
export interface PhoneLinkStatus {
  running: boolean;
  port: number;
  /** LAN IPv4s a phone could actually reach, best guess first. */
  addresses: string[];
  protocolVersion: number;
}

export const IDLE_STATUS: PhoneLinkStatus = {
  running: false,
  port: 0,
  addresses: [],
  protocolVersion: 0,
};

export function getStoredPhoneLinkEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function persistPhoneLinkEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(enabled));
}

export async function readStatus(): Promise<PhoneLinkStatus> {
  if (!isTauriRuntime()) return IDLE_STATUS;
  return invoke<PhoneLinkStatus>("get_lan_status");
}

export async function startServer(): Promise<PhoneLinkStatus> {
  if (!isTauriRuntime()) return IDLE_STATUS;
  return invoke<PhoneLinkStatus>("start_lan_server");
}

export async function stopServer(): Promise<PhoneLinkStatus> {
  if (!isTauriRuntime()) return IDLE_STATUS;
  return invoke<PhoneLinkStatus>("stop_lan_server");
}

/** Mirrors `PairedDevice` in `pairing.rs`. */
export interface PairedDevice {
  id: string;
  name: string;
  tokenHash: string;
  pairedAtMs: number;
  lastSeenMs: number | null;
}

/** Mirrors `PairingState` in `lan.rs`. `code` is present only while an
 *  invitation is open. */
export interface PairingState {
  code: string | null;
  expiresAtMs: number | null;
  devices: PairedDevice[];
}

export const IDLE_PAIRING: PairingState = {
  code: null,
  expiresAtMs: null,
  devices: [],
};

export async function readPairingState(): Promise<PairingState> {
  if (!isTauriRuntime()) return IDLE_PAIRING;
  return invoke<PairingState>("get_pairing_state");
}

export async function beginPairing(): Promise<PairingState> {
  if (!isTauriRuntime()) return IDLE_PAIRING;
  return invoke<PairingState>("begin_pairing");
}

export async function cancelPairing(): Promise<PairingState> {
  if (!isTauriRuntime()) return IDLE_PAIRING;
  return invoke<PairingState>("cancel_pairing");
}

export async function forgetDevice(id: string): Promise<PairingState> {
  if (!isTauriRuntime()) return IDLE_PAIRING;
  return invoke<PairingState>("forget_paired_device", { id });
}

/** The page a phone opens to type the code in. */
export function pairUrl(address: string, port: number): string {
  return `http://${address}:${port}/pair`;
}

/**
 * The URL to type into a phone's browser to prove it can reach this machine.
 * Shown rather than hidden because "can my phone see my PC" is otherwise an
 * invisible property of a network, and the answer decides whether the feature
 * can work here at all.
 */
export function healthUrl(address: string, port: number): string {
  return `http://${address}:${port}/health`;
}
