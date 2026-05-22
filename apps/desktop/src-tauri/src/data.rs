use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS reminder_nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  title TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  description TEXT,
  scheduled_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  reminder_type TEXT NOT NULL CHECK (
    reminder_type IN ('main', 'prep', 'followup', 'deadline', 'cooldown')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'done', 'missed', 'snoozed', 'cancelled')
  ),
  category TEXT NOT NULL CHECK (
    category IN (
      'university',
      'investing',
      'personal',
      'tutoring',
      'urgent',
      'waiting',
      'uncategorized'
    )
  ),
  parent_id TEXT,
  previous_id TEXT,
  next_id TEXT,
  checklist_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  snoozed_until TEXT,
  created_on_device_id TEXT NOT NULL,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reminder_nodes_status_scheduled_at
  ON reminder_nodes (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_reminder_nodes_parent_id
  ON reminder_nodes (parent_id);
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderNode {
    pub id: String,
    pub user_id: Option<String>,
    pub title: String,
    pub raw_input: String,
    pub description: Option<String>,
    pub scheduled_at: String,
    pub timezone: String,
    #[serde(rename = "type")]
    pub reminder_type: String,
    pub status: String,
    pub category: String,
    pub parent_id: Option<String>,
    pub previous_id: Option<String>,
    pub next_id: Option<String>,
    pub checklist: Vec<String>,
    pub confidence: f64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub snoozed_until: Option<String>,
    pub created_on_device_id: String,
    pub sync_version: i64,
}

pub struct ReminderStore {
    connection: Connection,
    database_path: PathBuf,
}

impl ReminderStore {
    pub fn open(app_handle: &AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle.path().app_data_dir().map_err(to_store_error)?;
        std::fs::create_dir_all(&app_data_dir).map_err(to_store_error)?;

        let database_path = app_data_dir.join("linodea.sqlite3");
        let connection = Connection::open(&database_path).map_err(to_store_error)?;
        let store = Self {
            connection,
            database_path,
        };
        store.migrate()?;

        Ok(store)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn create_reminder(&self, reminder: ReminderNode) -> Result<ReminderNode, String> {
        validate_reminder(&reminder)?;

        let checklist_json = serde_json::to_string(&reminder.checklist).map_err(to_store_error)?;
        self.connection
            .execute(
                r#"
                INSERT INTO reminder_nodes (
                  id,
                  user_id,
                  title,
                  raw_input,
                  description,
                  scheduled_at,
                  timezone,
                  reminder_type,
                  status,
                  category,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  confidence,
                  created_at,
                  updated_at,
                  completed_at,
                  snoozed_until,
                  created_on_device_id,
                  sync_version
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
                "#,
                params![
                    reminder.id,
                    reminder.user_id,
                    reminder.title,
                    reminder.raw_input,
                    reminder.description,
                    reminder.scheduled_at,
                    reminder.timezone,
                    reminder.reminder_type,
                    reminder.status,
                    reminder.category,
                    reminder.parent_id,
                    reminder.previous_id,
                    reminder.next_id,
                    checklist_json,
                    reminder.confidence,
                    reminder.created_at,
                    reminder.updated_at,
                    reminder.completed_at,
                    reminder.snoozed_until,
                    reminder.created_on_device_id,
                    reminder.sync_version,
                ],
            )
            .map_err(to_store_error)?;

        self.get_reminder_by_id(&reminder.id)?
            .ok_or_else(|| "Reminder was inserted but could not be read back.".to_string())
    }

    pub fn list_reminders(&self) -> Result<Vec<ReminderNode>, String> {
        let mut statement = self
            .connection
            .prepare(
                r#"
                SELECT
                  id,
                  user_id,
                  title,
                  raw_input,
                  description,
                  scheduled_at,
                  timezone,
                  reminder_type,
                  status,
                  category,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  confidence,
                  created_at,
                  updated_at,
                  completed_at,
                  snoozed_until,
                  created_on_device_id,
                  sync_version
                FROM reminder_nodes
                ORDER BY scheduled_at ASC, created_at ASC
                "#,
            )
            .map_err(to_store_error)?;

        let rows = statement
            .query_map([], reminder_from_row)
            .map_err(to_store_error)?;
        let mut reminders = Vec::new();

        for row in rows {
            reminders.push(row.map_err(to_store_error)?);
        }

        Ok(reminders)
    }

    fn migrate(&self) -> Result<(), String> {
        self.connection
            .execute_batch(SCHEMA)
            .map_err(to_store_error)
    }

    fn get_reminder_by_id(&self, id: &str) -> Result<Option<ReminderNode>, String> {
        let mut statement = self
            .connection
            .prepare(
                r#"
                SELECT
                  id,
                  user_id,
                  title,
                  raw_input,
                  description,
                  scheduled_at,
                  timezone,
                  reminder_type,
                  status,
                  category,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  confidence,
                  created_at,
                  updated_at,
                  completed_at,
                  snoozed_until,
                  created_on_device_id,
                  sync_version
                FROM reminder_nodes
                WHERE id = ?1
                "#,
            )
            .map_err(to_store_error)?;

        let mut rows = statement.query(params![id]).map_err(to_store_error)?;
        match rows.next().map_err(to_store_error)? {
            Some(row) => reminder_from_row(row).map(Some).map_err(to_store_error),
            None => Ok(None),
        }
    }

    #[cfg(test)]
    fn open_in_memory() -> Result<Self, String> {
        let store = Self {
            connection: Connection::open_in_memory().map_err(to_store_error)?,
            database_path: PathBuf::from(":memory:"),
        };
        store.migrate()?;
        Ok(store)
    }
}

fn reminder_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReminderNode> {
    let checklist_json: String = row.get("checklist_json")?;
    let checklist = serde_json::from_str(&checklist_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            checklist_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;

    Ok(ReminderNode {
        id: row.get("id")?,
        user_id: row.get("user_id")?,
        title: row.get("title")?,
        raw_input: row.get("raw_input")?,
        description: row.get("description")?,
        scheduled_at: row.get("scheduled_at")?,
        timezone: row.get("timezone")?,
        reminder_type: row.get("reminder_type")?,
        status: row.get("status")?,
        category: row.get("category")?,
        parent_id: row.get("parent_id")?,
        previous_id: row.get("previous_id")?,
        next_id: row.get("next_id")?,
        checklist,
        confidence: row.get("confidence")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        completed_at: row.get("completed_at")?,
        snoozed_until: row.get("snoozed_until")?,
        created_on_device_id: row.get("created_on_device_id")?,
        sync_version: row.get("sync_version")?,
    })
}

fn validate_reminder(reminder: &ReminderNode) -> Result<(), String> {
    if reminder.id.trim().is_empty() {
        return Err("Reminder id is required.".to_string());
    }

    if reminder.title.trim().is_empty() {
        return Err("Reminder title is required.".to_string());
    }

    if reminder.raw_input.trim().is_empty() {
        return Err("Reminder raw input is required.".to_string());
    }

    if reminder.scheduled_at.trim().is_empty() {
        return Err("Reminder scheduled time is required.".to_string());
    }

    if reminder.created_on_device_id.trim().is_empty() {
        return Err("Reminder device id is required.".to_string());
    }

    Ok(())
}

fn to_store_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_lists_reminders() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        let reminder = sample_reminder("reminder-1");

        let created = store
            .create_reminder(reminder.clone())
            .expect("reminder is created");
        let reminders = store.list_reminders().expect("reminders are listed");

        assert_eq!(created.id, reminder.id);
        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].title, "Check render");
        assert_eq!(reminders[0].checklist, vec!["logs"]);
    }

    #[test]
    fn rejects_missing_required_text() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        let mut reminder = sample_reminder("reminder-1");
        reminder.title.clear();

        let result = store.create_reminder(reminder);

        assert!(result.is_err());
    }

    fn sample_reminder(id: &str) -> ReminderNode {
        ReminderNode {
            id: id.to_string(),
            user_id: None,
            title: "Check render".to_string(),
            raw_input: "in 30m check render open logs".to_string(),
            description: None,
            scheduled_at: "2026-05-22T12:30:00.000Z".to_string(),
            timezone: "Asia/Jakarta".to_string(),
            reminder_type: "main".to_string(),
            status: "pending".to_string(),
            category: "uncategorized".to_string(),
            parent_id: None,
            previous_id: None,
            next_id: None,
            checklist: vec!["logs".to_string()],
            confidence: 0.9,
            created_at: "2026-05-22T12:00:00.000Z".to_string(),
            updated_at: "2026-05-22T12:00:00.000Z".to_string(),
            completed_at: None,
            snoozed_until: None,
            created_on_device_id: "device-1".to_string(),
            sync_version: 0,
        }
    }
}
