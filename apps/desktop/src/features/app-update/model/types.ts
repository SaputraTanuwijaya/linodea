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
  /** The feed offers a newer version; `nextVersion` is set. */
  | "available"
  | "upToDate"
  /** Downloading + installing. The app relaunches at the end of this phase. */
  | "downloading"
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
   * Manual check from Settings. Surfaces "checking" / "up to date" / "error"
   * inline instead of opening the confirm window — the user is already looking
   * at the panel that answers them.
   */
  check: () => Promise<void>;
  /** Download + install the pending update, then relaunch. Never returns. */
  install: () => Promise<void>;
}
