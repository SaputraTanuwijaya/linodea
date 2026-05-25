use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_MENU_SHOW: &str = "show_main_window";
const TRAY_MENU_HIDE: &str = "hide_main_window";
const TRAY_MENU_QUIT: &str = "quit_app";

pub fn setup_desktop_integration(app: &mut App) -> tauri::Result<()> {
    hide_main_window_on_close(app.handle())?;
    setup_tray(app)?;
    Ok(())
}

pub fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = main_window(app)?;
    window.show()?;
    let _ = window.unminimize();
    window.set_focus()?;
    Ok(())
}

pub fn hide_main_window(app: &AppHandle) -> tauri::Result<()> {
    main_window(app)?.hide()
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
        .text(TRAY_MENU_SHOW, "Show Linodea")
        .text(TRAY_MENU_HIDE, "Hide")
        .separator()
        .text(TRAY_MENU_QUIT, "Quit")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("Linodea")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW => {
                let _ = show_main_window(app);
            }
            TRAY_MENU_HIDE => {
                let _ = hide_main_window(app);
            }
            TRAY_MENU_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if is_left_click_release(&event) {
                let _ = show_main_window(tray.app_handle());
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
