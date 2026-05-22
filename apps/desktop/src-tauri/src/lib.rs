mod data;

use std::sync::Mutex;

use data::{ReminderNode, ReminderStatusPatch, ReminderStore};
use tauri::Manager;

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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let store = ReminderStore::open(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(AppState {
                reminders: Mutex::new(store),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_reminder_node,
            list_reminder_nodes,
            list_due_reminder_nodes,
            update_reminder_node_status,
            get_local_database_path,
            get_local_schema_version
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
