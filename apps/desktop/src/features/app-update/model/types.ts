/**
 * App-update feature contracts.
 *
 * The updater plugin ships in the installed build only; in `npm run dev`
 * (browser) and in tests there is no Tauri runtime, hence `supported`.
 */

export type AppUpdatePhase =
  /** Nothing checked yet this session (or a silent check failed). */
  | "idle"
  | "checking"
  | "upToDate"
  /** Fetching the payload in the background. Not disruptive, so never prompts. */
  | "downloading"
  /**
   * Downloaded and waiting on the user. This is the only phase that badges:
   * it is the only one where clicking does something instant.
   */
  | "ready"
  /** Applying. The app relaunches at the end of this phase, so it is brief. */
  | "installing"
  /** Only ever set by a manual check — silent checks fall back to "idle". */
  | "error";

export interface AppUpdateState {
  phase: AppUpdatePhase;
  /** Whether the updater plugin can run at all (installed desktop build). */
  supported: boolean;
  /** Running app version. Null until read, or if the read fails. */
  currentVersion: string | null;
  /** Version offered by the feed. Set in "available" / "downloading" only. */
  nextVersion: string | null;
}

export interface AppUpdateController {
  state: AppUpdateState;
  /**
   * Manual check from Settings. Reports inline; a found update downloads
   * itself in the background exactly like the automatic check does.
   */
  check: () => Promise<void>;
  /**
   * Apply the already-downloaded update and relaunch. Never returns on the
   * success path. No-op unless the phase is "ready".
   */
  install: () => Promise<void>;
}
