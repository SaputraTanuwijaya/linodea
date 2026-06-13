use serde::{Deserialize, Serialize};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const ALERT_WINDOW_LABEL: &str = "alert";
const TIMER_WINDOW_LABEL: &str = "timer";
const NOTIFY_EVENT: &str = "linodea:notify";
const TIMER_EVENT: &str = "linodea:timer";
const ALERT_SIZE: (f64, f64) = (360.0, 120.0);
const TIMER_SIZE: (f64, f64) = (220.0, 120.0);
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
            TRAY_MENU_QUIT => app.exit(0),
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
