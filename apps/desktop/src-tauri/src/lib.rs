mod ai;
mod data;
mod desktop;
mod shortcut;

use std::sync::Mutex;

use data::{
    AdvanceRecurrencePatch, ChainNode, MovePatch, ReminderCategoryPatch, ReminderEditPatch,
    ReminderNode, ReminderStatusPatch, ReminderStore,
};
use tauri::{LogicalSize, Manager};

struct AppState {
    reminders: Mutex<ReminderStore>,
    ai: ai::AiService,
}

#[tauri::command]
fn get_ai_assist_status(
    state: tauri::State<'_, AppState>,
) -> Result<ai::AiStatus, ai::AiCommandError> {
    state.ai.status()
}

#[tauri::command]
async fn save_and_test_ai_api_key(
    state: tauri::State<'_, AppState>,
    api_key: String,
) -> Result<ai::SaveKeyResult, ai::AiCommandError> {
    state.ai.save_and_test_key(api_key).await
}

#[tauri::command]
fn delete_ai_api_key(
    state: tauri::State<'_, AppState>,
) -> Result<ai::AiStatus, ai::AiCommandError> {
    state.ai.delete_key()
}

#[tauri::command]
async fn list_ai_models(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ai::AiModel>, ai::AiCommandError> {
    state.ai.list_models().await
}

#[tauri::command]
async fn normalize_reminder_with_ai(
    state: tauri::State<'_, AppState>,
    request: ai::AiNormalizeRequest,
) -> Result<ai::AiNormalizationResult, ai::AiCommandError> {
    state.ai.normalize(request).await
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
fn set_reminder_node_category(
    state: tauri::State<'_, AppState>,
    patch: ReminderCategoryPatch,
) -> Result<ReminderNode, String> {
    let store = state
        .reminders
        .lock()
        .map_err(|_| "Reminder store lock was poisoned.".to_string())?;

    store.set_reminder_category(patch)
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
fn enter_ai_settings_mode(app: tauri::AppHandle) -> Result<(), String> {
    desktop::show_ai_settings_mode(&app).map_err(|error| error.to_string())
}

// Adjust the capture window's height in place (for the ••• menu and the
// slash/anchor dropdowns) WITHOUT re-centering — re-centering shifts the capture
// bar upward as it grows, which reads as the popup "jumping". Growing downward
// from a fixed top keeps the bar pinned. Mode switches still recenter via
// `show_in_mode`, so switching to chain/list/settings can still reposition.
#[tauri::command]
fn set_popup_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window
        .set_size(LogicalSize::new(620.0, height))
        .map_err(|error| error.to_string())?;
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
fn show_confirm(app: tauri::AppHandle, payload: desktop::ConfirmPayload) -> Result<(), String> {
    desktop::show_confirm(&app, payload).map_err(|error| error.to_string())
}

#[tauri::command]
fn dismiss_confirm(app: tauri::AppHandle) -> Result<(), String> {
    desktop::hide_confirm(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn take_pending_confirm() -> Option<String> {
    desktop::take_pending_confirm()
}

#[tauri::command]
fn mark_boot_prompt_answered(app: tauri::AppHandle) {
    desktop::mark_boot_prompt_answered(&app);
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        // Must be registered first: on a second launch the plugin routes to this
        // callback in the already-running instance and exits the new process, so
        // a double-click surfaces the existing app instead of spawning a second
        // tray. (Tauri requires single-instance be the first plugin.)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = desktop::show_capture_mode(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Tag boot launches so setup() can tell them from manual launches and
            // keep them hidden (start-minimized) while surfacing manual launches.
            Some(vec!["--autostarted"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = ReminderStore::open(&app.handle()).map_err(std::io::Error::other)?;
            app.manage(AppState {
                reminders: Mutex::new(store),
                ai: ai::AiService::new(),
            });
            desktop::setup_desktop_integration(app)?;
            shortcut::setup_global_shortcut(app)?;

            // Startup visibility. Boot launches (autostart, tagged above) stay
            // hidden. A manual launch surfaces something so the user knows the app
            // is running: the first-run launch-on-boot prompt if unanswered, else
            // the capture bar. The prompt is triggered here — in unthrottled Rust
            // setup — instead of a hidden-window JS timer, which fired unreliably.
            let launched_on_boot = std::env::args().any(|arg| arg == "--autostarted");
            if !launched_on_boot {
                let handle = app.handle();
                if desktop::is_boot_prompt_answered(handle) {
                    let _ = desktop::show_capture_mode(handle);
                } else {
                    let _ = desktop::prompt_launch_on_boot(handle);
                }
            }

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
            set_reminder_node_category,
            delete_reminder_node,
            advance_reminder_recurrence,
            get_local_database_path,
            get_local_schema_version,
            get_ai_assist_status,
            save_and_test_ai_api_key,
            delete_ai_api_key,
            list_ai_models,
            normalize_reminder_with_ai,
            show_main_window,
            hide_main_window,
            enter_capture_mode,
            enter_list_mode,
            enter_chain_mode,
            enter_settings_mode,
            enter_ai_settings_mode,
            set_popup_height,
            show_alert,
            dismiss_alert,
            show_timer,
            dismiss_timer,
            show_confirm,
            dismiss_confirm,
            take_pending_confirm,
            mark_boot_prompt_answered,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
