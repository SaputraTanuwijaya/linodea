/**
 * Runtime helpers.
 */

/**
 * True when the app is running inside a Tauri WebView (versus a plain browser
 * dev preview). Used to gate native calls (`invoke`, native window APIs).
 */
export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
