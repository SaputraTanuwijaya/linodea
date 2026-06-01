mod data;
mod desktop;
mod shortcut;

use std::sync::Mutex;

use data::{
    AdvanceRecurrencePatch, ChainNode, MovePatch, ReminderEditPatch, ReminderNode,
    ReminderStatusPatch, ReminderStore,
};
use tauri::{LogicalSize, Manager};

struct AppState {
    reminders: Mutex<ReminderStore>,
}

#[tauri::command]
fn create_reminder_node(
    state: tauri::State<'_, AppState>,
    reminder: ReminderNode,
) -> Result<ReminderNode, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.create_reminder(reminder)
}

#[tauri::command]
fn list_reminder_nodes(state: tauri::State<'_, AppState>) -> Result<Vec<ReminderNode>, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.list_reminders()
}

#[tauri::command]
fn list_due_reminder_nodes(
    state: tauri::State<'_, AppState>,
    now: String,
) -> Result<Vec<ReminderNode>, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.list_due_reminders(&now)
}

#[tauri::command]
fn update_reminder_node_status(
    state: tauri::State<'_, AppState>,
    patch: ReminderStatusPatch,
) -> Result<ReminderNode, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.update_reminder_status(patch)
}

#[tauri::command]
fn update_reminder_node(
    state: tauri::State<'_, AppState>,
    patch: ReminderEditPatch,
) -> Result<ReminderNode, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.update_reminder(patch)
}

#[tauri::command]
fn move_reminder_node(
    state: tauri::State<'_, AppState>,
    patch: MovePatch,
) -> Result<ReminderNode, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.move_reminder(patch)
}

#[tauri::command]
fn list_reminder_chains(state: tauri::State<'_, AppState>) -> Result<Vec<ChainNode>, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.list_reminder_chains()
}

#[tauri::command]
fn delete_reminder_node(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.delete_reminder(&id)
}

#[tauri::command]
fn advance_reminder_recurrence(
    state: tauri::State<'_, AppState>,
    patch: AdvanceRecurrencePatch,
) -> Result<ReminderNode, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.advance_reminder_recurrence(patch)
}

#[tauri::command]
fn get_local_database_path(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    Ok(store.database_path().to_string_lossy().into_owned())
}

#[tauri::command]
fn get_local_schema_version(state: tauri::State<'_, AppState>) -> Result<i64, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.schema_version()
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    desktop::show_main_window(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    desktop::hide_main_window(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn enter_capture_mode(app: tauri::AppHandle) -> Result<(), String> {
    desktop::show_capture_mode(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn enter_list_mode(app: tauri::AppHandle) -> Result<(), String> {
    desktop::show_list_mode(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn enter_chain_mode(app: tauri::AppHandle) -> Result<(), String> {
    desktop::show_chain_mode(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn enter_settings_mode(app: tauri::AppHandle) -> Result<(), String> {
    desktop::show_settings_mode(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_popup_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window
        .set_size(LogicalSize::new(620.0, height))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn show_alert(app: tauri::AppHandle, payload: desktop::AlertPayload) -> Result<(), String> {
    desktop::show_alert(&app, payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn dismiss_alert(app: tauri::AppHandle) -> Result<(), String> {
    desktop::hide_alert(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn show_timer(app: tauri::AppHandle, payload: desktop::TimerPayload) -> Result<(), String> {
    desktop::show_timer(&app, payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn dismiss_timer(app: tauri::AppHandle) -> Result<(), String> {
    desktop::hide_timer(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let store = ReminderStore::open(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(AppState {
                reminders: Mutex::new(store),
            });
            desktop::setup_desktop_integration(app)?;
            shortcut::setup_global_shortcut(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_reminder_node,
            list_reminder_nodes,
            list_due_reminder_nodes,
            update_reminder_node_status,
            update_reminder_node,
            move_reminder_node,
            list_reminder_chains,
            delete_reminder_node,
            advance_reminder_recurrence,
            get_local_database_path,
            get_local_schema_version,
            show_main_window,
            hide_main_window,
            enter_capture_mode,
            enter_list_mode,
            enter_chain_mode,
            enter_settings_mode,
            set_popup_height,
            show_alert,
            dismiss_alert,
            show_timer,
            dismiss_timer,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
