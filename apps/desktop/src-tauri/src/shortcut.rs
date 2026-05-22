use tauri::App;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::desktop;

const CAPTURE_SHORTCUT_NAME: &str = "Ctrl+Alt+Space";

pub fn setup_global_shortcut(app: &mut App) -> tauri::Result<()> {
    let capture_shortcut = capture_shortcut_definition();
    let capture_shortcut_for_handler = capture_shortcut_definition();

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &capture_shortcut_for_handler {
                    match event.state() {
                        ShortcutState::Pressed => {
                            let _ = desktop::show_main_window(app);
                        }
                        ShortcutState::Released => {}
                    }
                }
            })
            .build(),
    )?;

    if let Err(error) = app.handle().global_shortcut().register(capture_shortcut) {
        eprintln!("Failed to register {CAPTURE_SHORTCUT_NAME}: {error}");
    }

    Ok(())
}

fn capture_shortcut_definition() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}
