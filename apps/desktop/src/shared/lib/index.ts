/**
 * Public surface for shared/lib.
 *
 * Small, pure helpers that any layer can import. No business logic, no state.
 */

export { formatDateTime } from "./datetime";
export { getDeviceId } from "./device";
export { openFeedbackForm } from "./feedback";
export { isTauriRuntime } from "./runtime";
export { playUiSound } from "./sounds";
