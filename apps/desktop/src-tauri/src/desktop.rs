use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, LogicalSize, Manager, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_MENU_CAPTURE: &str = "show_capture";
const TRAY_MENU_REMINDERS: &str = "show_reminders";
const TRAY_MENU_SETTINGS: &str = "show_settings";
const TRAY_MENU_HIDE: &str = "hide_main_window";
const TRAY_MENU_QUIT: &str = "quit_app";

const CAPTURE_SIZE: (f64, f64) = (620.0, 130.0);
const LIST_SIZE: (f64, f64) = (620.0, 420.0);
const SETTINGS_SIZE: (f64, f64) = (620.0, 660.0);

const MODE_EVENT: &str = "linodea:mode";
const MODE_CAPTURE: &str = "capture";
const MODE_LIST: &str = "list";
const MODE_SETTINGS: &str = "settings";

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

pub fn show_settings_mode(app: &AppHandle) -> tauri::Result<()> {
    show_in_mode(app, SETTINGS_SIZE, MODE_SETTINGS)
}

pub fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    show_capture_mode(app)
}

pub fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    main_window(app)?.hide()
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
