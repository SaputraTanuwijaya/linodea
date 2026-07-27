/**
 * Tauri event names crossing the window boundary.
 *
 * These are contracts, not local constants: Rust emits them and more than one
 * window listens (the confirm window emits `linodea:confirm-result`, the main
 * window routes it). Re-typing the literal per page is how the two sides drift.
 */

/**
 * Rust -> main window: switch popup mode.
 * Payload: `"capture" | "list" | "chain" | "settings"`, optionally
 * `"settings:<sectionId>"` to focus one section.
 */
export const MODE_EVENT = "linodea:mode";

/** Rust -> confirm window: which question to render. */
export const CONFIRM_EVENT = "linodea:confirm";

/** Confirm window -> main window: the user's answer. */
export const CONFIRM_RESULT_EVENT = "linodea:confirm-result";
