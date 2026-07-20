use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

/// Set by `show_confirm` before the confirm window is shown; drained by the
/// webview on mount. Covers the first-run race where the confirm window may not
/// yet be listening when the very first `show_confirm` fires at startup (the
/// autostart prompt) — without it the window would show empty.
static PENDING_CONFIRM: Mutex<Option<String>> = Mutex::new(None);

const MAIN_WINDOW_LABEL: &str = "main";
const ALERT_WINDOW_LABEL: &str = "alert";
const TIMER_WINDOW_LABEL: &str = "timer";
const CONFIRM_WINDOW_LABEL: &str = "confirm";
const NOTIFY_EVENT: &str = "linodea:notify";
const TIMER_EVENT: &str = "linodea:timer";
/// Carries the confirmation kind ("quit" | "autostart") to the confirm window.
const CONFIRM_EVENT: &str = "linodea:confirm";
const ALERT_SIZE: (f64, f64) = (360.0, 120.0);
const TIMER_SIZE: (f64, f64) = (220.0, 120.0);
const CONFIRM_SIZE: (f64, f64) = (380.0, 200.0);
/// Logical gap from the screen edges; the extra bottom slack clears the taskbar.
const BOTTOM_RIGHT_MARGIN: f64 = 16.0;
const BOTTOM_RIGHT_SLACK: f64 = 48.0;
const TRAY_MENU_CAPTURE: &str = "show_capture";
const TRAY_MENU_REMINDERS: &str = "show_reminders";
const TRAY_MENU_CHAINS: &str = "show_chains";
const TRAY_MENU_SETTINGS: &str = "show_settings";
const TRAY_MENU_HIDE: &str = "hide_main_window";
const TRAY_MENU_QUIT: &str = "quit_app";

const CAPTURE_SIZE: (f64, f64) = (620.0, 130.0);
const LIST_SIZE: (f64, f64) = (620.0, 420.0);
const CHAIN_SIZE: (f64, f64) = (620.0, 420.0);
const SETTINGS_SIZE: (f64, f64) = (620.0, 660.0);

const MODE_EVENT: &str = "linodea:mode";
const MODE_CAPTURE: &str = "capture";
const MODE_LIST: &str = "list";
const MODE_CHAIN: &str = "chain";
const MODE_SETTINGS: &str = "settings";
const MODE_AI_SETTINGS: &str = "settings:ai-assist";

pub fn setup_desktop_integration(app: &mut App) -> tauri::Result<()> {
    hide_main_window_on_close(app.handle())?;
    setup_tray(app)?;
    Ok(())
}

pub fn show_capture_mode(app: &AppHandle) -> tauri::Result<()> {
    show_in_mode(app, CAPTURE_SIZE, MODE_CAPTURE)
}

pub fn show_list_mode(app: &AppHandle) -> tauri::Result<()> {
    show_in_mode(app, LIST_SIZE, MODE_LIST)
}

pub fn show_chain_mode(app: &AppHandle) -> tauri::Result<()> {
    show_in_mode(app, CHAIN_SIZE, MODE_CHAIN)
}

pub fn show_settings_mode(app: &AppHandle) -> tauri::Result<()> {
    show_in_mode(app, SETTINGS_SIZE, MODE_SETTINGS)
}

pub fn show_ai_settings_mode(app: &AppHandle) -> tauri::Result<()> {
    show_in_mode(app, SETTINGS_SIZE, MODE_AI_SETTINGS)
}

pub fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    show_capture_mode(app)
}

pub fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    main_window(app)?.hide()
}

/// Data for the custom Linodea alert window. The alert webview formats the
/// human text from this via i18n, so we pass structured fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertPayload {
    pub reminder_id: String,
    pub title: String,
    pub kind: String,
    pub lead_minutes: Option<u32>,
    pub when_ms: i64,
}

/// Show the custom alert window bottom-right, carrying `payload`. Deliberately
/// never focuses the window — it grabs attention without stealing input.
pub fn show_alert(app: &AppHandle, payload: AlertPayload) -> tauri::Result<()> {
    let window = alert_window(app)?;
    let _ = position_bottom_right(&window, ALERT_SIZE);
    let _ = app.emit_to(ALERT_WINDOW_LABEL, NOTIFY_EVENT, payload);
    window.show()?;
    let _ = window.set_always_on_top(true);
    Ok(())
}

pub fn hide_alert(app: &AppHandle) -> tauri::Result<()> {
    alert_window(app)?.hide()
}

/// Data for the on-screen countdown timer window. The timer webview ticks the
/// remaining time from `target_ms` (epoch ms) down to zero.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerPayload {
    pub title: String,
    pub target_ms: i64,
}

/// Show the countdown timer window bottom-right, carrying `payload`. Like the
/// alert, it never steals focus. A new countdown replaces the shown one.
pub fn show_timer(app: &AppHandle, payload: TimerPayload) -> tauri::Result<()> {
    let window = timer_window(app)?;
    let _ = position_bottom_right(&window, TIMER_SIZE);
    let _ = app.emit_to(TIMER_WINDOW_LABEL, TIMER_EVENT, payload);
    window.show()?;
    let _ = window.set_always_on_top(true);
    Ok(())
}

pub fn hide_timer(app: &AppHandle) -> tauri::Result<()> {
    timer_window(app)?.hide()
}

/// Which decision the confirm window is asking about. The webview renders the
/// themed, localized copy for the kind and emits `linodea:confirm-result`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmPayload {
    /// "quit" | "autostart" | "autostartOff" | "update". Passed through
    /// unchanged — new kinds are frontend-only (copy + result handling).
    pub kind: String,
}

/// Show the themed confirmation window centered and focused. Unlike the alert,
/// this one takes focus so Enter/Escape work and it reads as a real prompt.
pub fn show_confirm(app: &AppHandle, payload: ConfirmPayload) -> tauri::Result<()> {
    let window = confirm_window(app)?;
    if let Ok(mut pending) = PENDING_CONFIRM.lock() {
        *pending = Some(payload.kind.clone());
    }
    let _ = window.set_size(LogicalSize::new(CONFIRM_SIZE.0, CONFIRM_SIZE.1));
    let _ = app.emit_to(CONFIRM_WINDOW_LABEL, CONFIRM_EVENT, payload);
    let _ = window.center();
    window.show()?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    Ok(())
}

pub fn hide_confirm(app: &AppHandle) -> tauri::Result<()> {
    confirm_window(app)?.hide()
}

/// Return and clear any confirmation kind stashed before the window was ready.
pub fn take_pending_confirm() -> Option<String> {
    PENDING_CONFIRM
        .lock()
        .ok()
        .and_then(|mut pending| pending.take())
}

const BOOT_PROMPT_MARKER: &str = "boot_prompt_answered";

fn boot_prompt_marker_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(BOOT_PROMPT_MARKER))
}

/// Whether the first-run launch-on-boot prompt has already been answered.
/// Persisted as a marker file, decided in Rust at startup. This deliberately
/// replaces the old localStorage flag + hidden-window `setTimeout`: WebView2
/// throttles/suspends timers in the hidden main window (the same reason the
/// scheduler needs its 15s backstop), so the prompt fired unreliably. Rust
/// setup runs unthrottled, so the trigger is now deterministic.
pub fn is_boot_prompt_answered(app: &AppHandle) -> bool {
    boot_prompt_marker_path(app)
        .map(|path| marker_answered(&path))
        .unwrap_or(false)
}

/// Record that the user answered the boot prompt (either choice) so it isn't
/// shown again. Best-effort: a write failure just means we may re-ask next launch.
pub fn mark_boot_prompt_answered(app: &AppHandle) {
    if let Some(path) = boot_prompt_marker_path(app) {
        write_marker(&path);
    }
}

/// The marker's persistence, split from the `AppHandle` path lookup so it can be
/// unit-tested against a temp dir: presence of the file == answered.
fn marker_answered(path: &Path) -> bool {
    path.exists()
}

/// Write the answered-marker, creating its parent dir if missing. Best-effort
/// (swallows IO errors) — a failed write just means the prompt may re-ask.
fn write_marker(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, b"1");
}

/// What to do with the main window at startup. Boot (autostart) launches stay
/// hidden; a manual launch surfaces the first-run prompt once, then the capture
/// bar thereafter. See [`startup_action`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupAction {
    /// Autostart/boot launch — stay hidden (start-minimized), surface nothing.
    StayHidden,
    /// Manual launch, prompt already answered — surface the capture bar.
    ShowCapture,
    /// Manual launch, first run — surface the launch-on-boot prompt (shown once).
    ShowBootPrompt,
}

/// The startup-visibility policy, extracted from the Tauri `setup()` closure so
/// it's explicit and unit-testable (the closure itself, wired to `AppHandle`,
/// is not). A boot launch must never steal focus with a window; a manual launch
/// must surface *something* so the user knows the app is running.
pub fn startup_action(launched_on_boot: bool, boot_prompt_answered: bool) -> StartupAction {
    if launched_on_boot {
        StartupAction::StayHidden
    } else if boot_prompt_answered {
        StartupAction::ShowCapture
    } else {
        StartupAction::ShowBootPrompt
    }
}

/// Show the first-run launch-on-boot prompt in the themed confirm window.
pub fn prompt_launch_on_boot(app: &AppHandle) -> tauri::Result<()> {
    show_confirm(
        app,
        ConfirmPayload {
            kind: "autostart".into(),
        },
    )
}

fn confirm_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window(CONFIRM_WINDOW_LABEL)
        .ok_or(tauri::Error::WindowNotFound)
}

fn alert_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window(ALERT_WINDOW_LABEL)
        .ok_or(tauri::Error::WindowNotFound)
}

fn timer_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window(TIMER_WINDOW_LABEL)
        .ok_or(tauri::Error::WindowNotFound)
}

/// Pin `window` to the bottom-right of its current monitor, leaving margin and
/// taskbar slack. `size` is the window's logical (width, height).
fn position_bottom_right(window: &WebviewWindow, size: (f64, f64)) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()? else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let m_pos = monitor.position();
    let m_size = monitor.size();
    let win_w = (size.0 + BOTTOM_RIGHT_MARGIN) * scale;
    let win_h = (size.1 + BOTTOM_RIGHT_MARGIN + BOTTOM_RIGHT_SLACK) * scale;
    let x = m_pos.x as f64 + m_size.width as f64 - win_w;
    let y = m_pos.y as f64 + m_size.height as f64 - win_h;
    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

fn show_in_mode(app: &AppHandle, size: (f64, f64), mode: &str) -> tauri::Result<()> {
    let window = main_window(app)?;
    window.set_size(LogicalSize::new(size.0, size.1))?;
    let _ = window.center();
    let _ = app.emit(MODE_EVENT, mode);
    window.show()?;
    let _ = window.unminimize();
    window.set_focus()?;
    Ok(())
}

fn hide_main_window_on_close(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;
    let window_to_hide = window.clone();

    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window_to_hide.hide();
        }
        WindowEvent::Focused(false) => {
            let _ = window_to_hide.hide();
        }
        _ => {}
    });

    Ok(())
}

fn setup_tray(app: &mut App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text(TRAY_MENU_CAPTURE, "Quick capture")
        .text(TRAY_MENU_REMINDERS, "Reminders")
        .text(TRAY_MENU_CHAINS, "Chains")
        .text(TRAY_MENU_SETTINGS, "Settings")
        .text(TRAY_MENU_HIDE, "Hide")
        .separator()
        .text(TRAY_MENU_QUIT, "Quit")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Linodea")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_CAPTURE => {
                let _ = show_capture_mode(app);
            }
            TRAY_MENU_REMINDERS => {
                let _ = show_list_mode(app);
            }
            TRAY_MENU_CHAINS => {
                let _ = show_chain_mode(app);
            }
            TRAY_MENU_SETTINGS => {
                let _ = show_settings_mode(app);
            }
            TRAY_MENU_HIDE => {
                let _ = hide_main_window(app);
            }
            TRAY_MENU_QUIT => {
                // Show the themed confirm window (reminders stop when quit). The
                // main window acts on the result via `linodea:confirm-result`.
                let _ = show_confirm(
                    app,
                    ConfirmPayload {
                        kind: "quit".into(),
                    },
                );
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if is_left_click_release(&event) {
                let _ = show_capture_mode(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn is_left_click_release(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or(tauri::Error::WindowNotFound)
}

#[cfg(test)]
mod tests {
    use super::{marker_answered, startup_action, write_marker, StartupAction};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    // The install-time reliability contract, one assertion per input combo.

    #[test]
    fn boot_launch_stays_hidden_regardless_of_prompt_state() {
        // Autostart handed us `--autostarted`: never surface a window on boot,
        // whether or not the first-run prompt was ever answered.
        assert_eq!(startup_action(true, true), StartupAction::StayHidden);
        assert_eq!(startup_action(true, false), StartupAction::StayHidden);
    }

    #[test]
    fn manual_launch_after_answering_shows_capture() {
        assert_eq!(startup_action(false, true), StartupAction::ShowCapture);
    }

    #[test]
    fn manual_first_run_shows_the_boot_prompt() {
        assert_eq!(startup_action(false, false), StartupAction::ShowBootPrompt);
    }

    #[test]
    fn marker_reads_unanswered_until_written_then_stays_answered() {
        let dir = unique_temp_dir();
        let path = dir.join("boot_prompt_answered");

        assert!(
            !marker_answered(&path),
            "fresh install: prompt not yet answered"
        );
        write_marker(&path);
        assert!(
            marker_answered(&path),
            "answered persists → the prompt won't show again",
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_marker_creates_a_missing_parent_dir() {
        // On first run the app-data dir may not exist yet; the write must create
        // it, or the marker never persists and the prompt re-fires every launch.
        let dir = unique_temp_dir();
        let nested = dir.join("app_data").join("boot_prompt_answered");
        assert!(!nested.parent().unwrap().exists());

        write_marker(&nested);
        assert!(marker_answered(&nested));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A process-unique temp dir without pulling in a `tempfile` dev-dependency.
    fn unique_temp_dir() -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("linodea_startup_test_{pid}_{n}"));
        std::fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }
}
