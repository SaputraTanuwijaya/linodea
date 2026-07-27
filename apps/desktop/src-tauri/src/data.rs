use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CURRENT_SCHEMA_VERSION: i64 = 4;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

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
  -- v4: replaced the `category` column (a CHECK-constrained enum of six fixed
  -- categories) with free-text user tags, stored as a JSON array exactly like
  -- `checklist_json`. No CHECK, no join table — tags are open-ended by design,
  -- and a local single-user store filters/groups them in the UI anyway.
  tags_json TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT,
  previous_id TEXT,
  next_id TEXT,
  checklist_json TEXT NOT NULL,
  recurrence_json TEXT,
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

CREATE TABLE IF NOT EXISTS reminder_fire_state (
  reminder_id TEXT PRIMARY KEY,
  due_fired INTEGER NOT NULL DEFAULT 0,
  fired_prealerts_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
"#;

/// Repeat rule for a recurring reminder, stored as JSON in `recurrence_json`.
/// Mirrors the `Recurrence` shape in `@linodea/types`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub freq: String,
    pub interval: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekday: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
}

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
    pub tags: Vec<String>,
    pub parent_id: Option<String>,
    pub previous_id: Option<String>,
    pub next_id: Option<String>,
    pub checklist: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<Recurrence>,
    pub confidence: f64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub snoozed_until: Option<String>,
    pub created_on_device_id: String,
    pub sync_version: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatusPatch {
    pub id: String,
    pub status: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub snoozed_until: Option<String>,
}

/// Full-content edit of an existing reminder. Distinct from `ReminderStatusPatch`
/// (status/lifecycle) — this changes the user-authored fields, re-derived by
/// re-parsing the edited raw text on the UI side. Also the primitive a future
/// AI-assisted chain editor would call to "alter" a node.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderEditPatch {
    pub id: String,
    pub title: String,
    pub raw_input: String,
    pub scheduled_at: String,
    pub timezone: String,
    #[serde(rename = "type")]
    pub reminder_type: String,
    pub tags: Vec<String>,
    pub checklist: Vec<String>,
    pub recurrence: Option<Recurrence>,
    pub updated_at: String,
}

/// Re-arm a recurring reminder onto its next occurrence: a new `scheduled_at`,
/// the (decremented) recurrence rule, and a reset to `pending`. Issued by the
/// JS scheduler when a recurring reminder fires.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceRecurrencePatch {
    pub id: String,
    pub scheduled_at: String,
    pub recurrence: Option<Recurrence>,
    pub updated_at: String,
}

/// Re-position a node within the chain forest: place it under `parent_id`
/// (None = a top-level root) immediately after sibling `after_id` (None = the
/// head of that sibling group). One primitive covers link, unlink (parent =
/// None), and reorder — and it is the write op a future AI chain editor would
/// call to push/pop/alter the parent/previous/next structure.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePatch {
    pub id: String,
    pub parent_id: Option<String>,
    pub after_id: Option<String>,
    pub updated_at: String,
}

/// Retag a reminder from the chain view. Replaces the old category-correction
/// patch: there is no auto-guess left to "fix", so this is straightforward
/// editing rather than an escape hatch. Optional and non-destructive —
/// reminders work fine untagged.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTagsPatch {
    pub id: String,
    pub tags: Vec<String>,
    pub updated_at: String,
}

/// Per-reminder scheduler dedupe: which alerts have already fired for a
/// reminder. `due` = the T-due alert fired; `prealerts` = the minute-offsets
/// whose prealert fired. Kept deliberately OUT of `reminder_nodes` — this is
/// local-device scheduler bookkeeping, not user reminder data, so it never
/// syncs to a Phase-2 phone and can be cleared independently (snooze / edit
/// re-fire). Lived in WebView2 localStorage until S64; moved here so a cleared
/// webview cache can no longer lose dedupe and re-fire historically-due
/// prealerts. Missing fields deserialize to `false` / `[]`, so a partial record
/// from the localStorage migration round-trips cleanly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FireRecord {
    #[serde(default)]
    pub due: bool,
    #[serde(default)]
    pub prealerts: Vec<i64>,
}

/// A node plus its ordered children, recursively. The assembled shape the
/// chain view renders (GitHub-commit style). Roots and each child group are
/// ordered by their previous/next links.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainNode {
    pub node: ReminderNode,
    pub children: Vec<ChainNode>,
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
        let database_existed = database_path.exists();
        let connection = Connection::open(&database_path).map_err(to_store_error)?;
        let store = Self {
            connection,
            database_path,
        };
        // Only an existing DB can be *upgraded*; a fresh install has nothing to
        // lose. Runs before `migrate()` writes anything, so the file on disk is
        // still consistent (no WAL, no open transaction) and safe to copy.
        if database_existed {
            store.backup_before_upgrade();
        }
        store.migrate()?;

        Ok(store)
    }

    /// Copy the database aside before a schema upgrade.
    ///
    /// Before auto-update, a migration only ran when a build was launched by
    /// hand. Now it runs unattended on every user's data the moment they accept
    /// an update, so a bad migration would be silent and unrecoverable. One
    /// rolling backup per source version (`linodea.v2.bak`) bounds disk use.
    ///
    /// Best-effort by design: every migration today is purely additive
    /// (`ADD COLUMN` / `CREATE TABLE IF NOT EXISTS`), so a failed copy isn't
    /// worth refusing to start over. **If a future migration ever drops or
    /// rewrites data, make this fail-closed (return Err) before shipping it.**
    fn backup_before_upgrade(&self) {
        let existing = self.recorded_schema_version();
        if existing >= CURRENT_SCHEMA_VERSION {
            return; // already current — no migration will run, nothing to guard
        }
        let backup = self
            .database_path
            .with_file_name(format!("linodea.v{existing}.bak"));
        let _ = std::fs::copy(&self.database_path, &backup);
    }

    /// Highest recorded migration version, or 0 when the DB predates the
    /// `schema_migrations` table (or is unreadable). Never errors — it only
    /// decides whether a backup is warranted.
    fn recorded_schema_version(&self) -> i64 {
        self.connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn create_reminder(&self, reminder: ReminderNode) -> Result<ReminderNode, String> {
        validate_reminder(&reminder)?;

        let tags_json = serialize_tags(&reminder.tags)?;
        let checklist_json = serde_json::to_string(&reminder.checklist).map_err(to_store_error)?;
        let recurrence_json = serialize_recurrence(&reminder.recurrence)?;
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
                  tags_json,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  recurrence_json,
                  confidence,
                  created_at,
                  updated_at,
                  completed_at,
                  snoozed_until,
                  created_on_device_id,
                  sync_version
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
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
                    tags_json,
                    reminder.parent_id,
                    reminder.previous_id,
                    reminder.next_id,
                    checklist_json,
                    recurrence_json,
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
                  tags_json,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  recurrence_json,
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

    pub fn list_due_reminders(&self, now: &str) -> Result<Vec<ReminderNode>, String> {
        if now.trim().is_empty() {
            return Err("Due reminder query time is required.".to_string());
        }

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
                  tags_json,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  recurrence_json,
                  confidence,
                  created_at,
                  updated_at,
                  completed_at,
                  snoozed_until,
                  created_on_device_id,
                  sync_version
                FROM reminder_nodes
                WHERE
                  (status = 'pending' AND scheduled_at <= ?1)
                  OR (status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?1)
                ORDER BY COALESCE(snoozed_until, scheduled_at) ASC, created_at ASC
                "#,
            )
            .map_err(to_store_error)?;

        let rows = statement
            .query_map(params![now], reminder_from_row)
            .map_err(to_store_error)?;
        let mut reminders = Vec::new();

        for row in rows {
            reminders.push(row.map_err(to_store_error)?);
        }

        Ok(reminders)
    }

    pub fn update_reminder_status(
        &self,
        patch: ReminderStatusPatch,
    ) -> Result<ReminderNode, String> {
        validate_status_patch(&patch)?;

        let completed_at = if patch.status == "done" {
            Some(
                patch
                    .completed_at
                    .clone()
                    .unwrap_or_else(|| patch.updated_at.clone()),
            )
        } else {
            None
        };
        let snoozed_until = if patch.status == "snoozed" {
            patch.snoozed_until.clone()
        } else {
            None
        };
        let changed = self
            .connection
            .execute(
                r#"
                UPDATE reminder_nodes
                SET
                  status = ?2,
                  updated_at = ?3,
                  completed_at = ?4,
                  snoozed_until = ?5,
                  sync_version = sync_version + 1
                WHERE id = ?1
                "#,
                params![
                    patch.id,
                    patch.status,
                    patch.updated_at,
                    completed_at,
                    snoozed_until
                ],
            )
            .map_err(to_store_error)?;

        if changed == 0 {
            return Err("Reminder was not found.".to_string());
        }

        self.get_reminder_by_id(&patch.id)?
            .ok_or_else(|| "Reminder was updated but could not be read back.".to_string())
    }

    pub fn update_reminder(&self, patch: ReminderEditPatch) -> Result<ReminderNode, String> {
        validate_edit_patch(&patch)?;

        let tags_json = serialize_tags(&patch.tags)?;
        let checklist_json = serde_json::to_string(&patch.checklist).map_err(to_store_error)?;
        let recurrence_json = serialize_recurrence(&patch.recurrence)?;
        let changed = self
            .connection
            .execute(
                r#"
                UPDATE reminder_nodes
                SET
                  title = ?2,
                  raw_input = ?3,
                  scheduled_at = ?4,
                  timezone = ?5,
                  reminder_type = ?6,
                  tags_json = ?7,
                  checklist_json = ?8,
                  recurrence_json = ?9,
                  updated_at = ?10,
                  sync_version = sync_version + 1
                WHERE id = ?1
                "#,
                params![
                    patch.id,
                    patch.title,
                    patch.raw_input,
                    patch.scheduled_at,
                    patch.timezone,
                    patch.reminder_type,
                    tags_json,
                    checklist_json,
                    recurrence_json,
                    patch.updated_at,
                ],
            )
            .map_err(to_store_error)?;

        if changed == 0 {
            return Err("Reminder was not found.".to_string());
        }

        self.get_reminder_by_id(&patch.id)?
            .ok_or_else(|| "Reminder was updated but could not be read back.".to_string())
    }

    /// Replace a reminder's tags (retagging from the chain view).
    pub fn set_reminder_tags(&self, patch: ReminderTagsPatch) -> Result<ReminderNode, String> {
        if patch.id.trim().is_empty() {
            return Err("Reminder id is required.".to_string());
        }
        if patch.updated_at.trim().is_empty() {
            return Err("Reminder update time is required.".to_string());
        }

        let tags_json = serialize_tags(&patch.tags)?;
        let changed = self
            .connection
            .execute(
                r#"
                UPDATE reminder_nodes
                SET tags_json = ?2, updated_at = ?3, sync_version = sync_version + 1
                WHERE id = ?1
                "#,
                params![patch.id, tags_json, patch.updated_at],
            )
            .map_err(to_store_error)?;

        if changed == 0 {
            return Err("Reminder was not found.".to_string());
        }

        self.get_reminder_by_id(&patch.id)?
            .ok_or_else(|| "Reminder tags were updated but could not be read back.".to_string())
    }

    /// Re-arm a recurring reminder onto its next occurrence: new time + rule,
    /// status back to `pending`, lifecycle timestamps cleared.
    pub fn advance_reminder_recurrence(
        &self,
        patch: AdvanceRecurrencePatch,
    ) -> Result<ReminderNode, String> {
        if patch.id.trim().is_empty() {
            return Err("Reminder id is required.".to_string());
        }
        if patch.scheduled_at.trim().is_empty() {
            return Err("Reminder scheduled time is required.".to_string());
        }

        let recurrence_json = serialize_recurrence(&patch.recurrence)?;
        let changed = self
            .connection
            .execute(
                r#"
                UPDATE reminder_nodes
                SET
                  scheduled_at = ?2,
                  recurrence_json = ?3,
                  status = 'pending',
                  completed_at = NULL,
                  snoozed_until = NULL,
                  updated_at = ?4,
                  sync_version = sync_version + 1
                WHERE id = ?1
                "#,
                params![
                    patch.id,
                    patch.scheduled_at,
                    recurrence_json,
                    patch.updated_at,
                ],
            )
            .map_err(to_store_error)?;

        if changed == 0 {
            return Err("Reminder was not found.".to_string());
        }

        self.get_reminder_by_id(&patch.id)?
            .ok_or_else(|| "Reminder was advanced but could not be read back.".to_string())
    }

    /// Re-position a node within the chain forest. Transactional: detaches the
    /// node from its current sibling group, then splices it into the target
    /// group, keeping every group a consistent doubly-linked list. Rejects
    /// self-parenting, parent cycles, and an `after` sibling that lives in a
    /// different group.
    pub fn move_reminder(&self, patch: MovePatch) -> Result<ReminderNode, String> {
        if patch.id.trim().is_empty() {
            return Err("Reminder id is required.".to_string());
        }
        if patch.updated_at.trim().is_empty() {
            return Err("Reminder update time is required.".to_string());
        }

        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(to_store_error)?;

        let current =
            fetch_links(&tx, &patch.id)?.ok_or_else(|| "Reminder was not found.".to_string())?;

        if let Some(parent) = patch.parent_id.as_deref() {
            if parent == patch.id {
                return Err("A reminder cannot be its own parent.".to_string());
            }
            if fetch_links(&tx, parent)?.is_none() {
                return Err("Parent reminder was not found.".to_string());
            }
            if is_descendant(&tx, &patch.id, parent)? {
                return Err("That move would create a cycle.".to_string());
            }
        }

        if let Some(after) = patch.after_id.as_deref() {
            if after == patch.id {
                return Err("A reminder cannot be placed after itself.".to_string());
            }
            let after_links = fetch_links(&tx, after)?
                .ok_or_else(|| "Sibling reminder was not found.".to_string())?;
            if after_links.parent.as_deref() != patch.parent_id.as_deref() {
                return Err("The sibling is not in the target group.".to_string());
            }
        }

        // 1. Detach from the current position, stitching old neighbors together.
        if let Some(previous) = current.previous.as_deref() {
            set_link(
                &tx,
                previous,
                "next_id",
                current.next.as_deref(),
                &patch.updated_at,
            )?;
        }
        if let Some(next) = current.next.as_deref() {
            set_link(
                &tx,
                next,
                "previous_id",
                current.previous.as_deref(),
                &patch.updated_at,
            )?;
        }

        // 2. Find the node's new neighbors in the target group.
        let (new_previous, new_next) = match patch.after_id.as_deref() {
            Some(after) => {
                let after_next = fetch_links(&tx, after)?.and_then(|links| links.next);
                (Some(after.to_string()), after_next)
            }
            None => (
                None,
                group_head(&tx, patch.parent_id.as_deref(), &patch.id)?,
            ),
        };

        // 3. Wire the node in and fix the neighbors that now point at it.
        set_all_links(
            &tx,
            &patch.id,
            patch.parent_id.as_deref(),
            new_previous.as_deref(),
            new_next.as_deref(),
            &patch.updated_at,
        )?;
        if let Some(previous) = new_previous.as_deref() {
            set_link(&tx, previous, "next_id", Some(&patch.id), &patch.updated_at)?;
        }
        if let Some(next) = new_next.as_deref() {
            set_link(&tx, next, "previous_id", Some(&patch.id), &patch.updated_at)?;
        }

        tx.commit().map_err(to_store_error)?;

        self.get_reminder_by_id(&patch.id)?
            .ok_or_else(|| "Reminder was moved but could not be read back.".to_string())
    }

    /// Read the whole fire-dedupe store as a `reminder_id -> FireRecord` map.
    /// The JS scheduler snapshots this once per pass to decide what still needs
    /// to fire.
    pub fn get_fire_records(&self) -> Result<HashMap<String, FireRecord>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT reminder_id, due_fired, fired_prealerts_json FROM reminder_fire_state")
            .map_err(to_store_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(to_store_error)?;

        let mut records = HashMap::new();
        for row in rows {
            let (id, due, prealerts_json) = row.map_err(to_store_error)?;
            let prealerts = serde_json::from_str(&prealerts_json).unwrap_or_default();
            records.insert(
                id,
                FireRecord {
                    due: due != 0,
                    prealerts,
                },
            );
        }
        Ok(records)
    }

    /// Upsert one reminder's fire record. Called when a prealert or the T-due
    /// alert fires. `updated_at` is stamped server-side (pure local bookkeeping,
    /// no need to match the reminder's own timestamps).
    pub fn set_fire_record(&self, reminder_id: String, record: FireRecord) -> Result<(), String> {
        if reminder_id.trim().is_empty() {
            return Err("Reminder id is required.".to_string());
        }
        let prealerts_json = serde_json::to_string(&record.prealerts).map_err(to_store_error)?;
        let updated_at = now_iso(&self.connection)?;
        self.connection
            .execute(
                r#"
                INSERT INTO reminder_fire_state (reminder_id, due_fired, fired_prealerts_json, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(reminder_id) DO UPDATE SET
                  due_fired = excluded.due_fired,
                  fired_prealerts_json = excluded.fired_prealerts_json,
                  updated_at = excluded.updated_at
                "#,
                params![
                    reminder_id,
                    i64::from(record.due),
                    prealerts_json,
                    updated_at
                ],
            )
            .map_err(to_store_error)?;
        Ok(())
    }

    /// Forget one reminder's fire record so it can fire again — used when a
    /// snooze/edit reschedules an already-fired reminder, and when a recurring
    /// reminder advances to its next occurrence. A no-op if no record exists.
    pub fn clear_fire_record(&self, reminder_id: &str) -> Result<(), String> {
        if reminder_id.trim().is_empty() {
            return Err("Reminder id is required.".to_string());
        }
        self.connection
            .execute(
                "DELETE FROM reminder_fire_state WHERE reminder_id = ?1",
                params![reminder_id],
            )
            .map_err(to_store_error)?;
        Ok(())
    }

    /// Assemble every node into its nested chain forest. Defensive against
    /// inconsistent data: a parent pointing at a missing node surfaces the
    /// child at root, and broken or cyclic previous/next links can neither
    /// drop a node nor loop forever.
    pub fn list_reminder_chains(&self) -> Result<Vec<ChainNode>, String> {
        Ok(assemble_chains(self.list_reminders()?))
    }

    /// Delete a node and keep the forest consistent: stitch its sibling
    /// neighbors, and promote its direct children into its slot (re-parented
    /// to the deleted node's parent, spliced in their existing order).
    pub fn delete_reminder(&self, id: &str) -> Result<(), String> {
        if id.trim().is_empty() {
            return Err("Reminder id is required.".to_string());
        }

        let tx = self
            .connection
            .unchecked_transaction()
            .map_err(to_store_error)?;

        let current = fetch_links(&tx, id)?.ok_or_else(|| "Reminder was not found.".to_string())?;
        let stamp = now_iso(&tx)?;
        let children = ordered_children(&tx, id)?;
        let left = current.previous.as_deref();
        let right = current.next.as_deref();

        if children.is_empty() {
            // No children: just close the gap the node leaves behind.
            if let Some(previous) = left {
                set_link(&tx, previous, "next_id", right, &stamp)?;
            }
            if let Some(next) = right {
                set_link(&tx, next, "previous_id", left, &stamp)?;
            }
        } else {
            let first = children.first().expect("children is non-empty").clone();
            let last = children.last().expect("children is non-empty").clone();

            // Re-parent the promoted children; their internal order is preserved.
            for child in &children {
                set_link(&tx, child, "parent_id", current.parent.as_deref(), &stamp)?;
            }
            // Splice the children run between the deleted node's neighbors.
            set_link(&tx, &first, "previous_id", left, &stamp)?;
            set_link(&tx, &last, "next_id", right, &stamp)?;
            if let Some(previous) = left {
                set_link(&tx, previous, "next_id", Some(&first), &stamp)?;
            }
            if let Some(next) = right {
                set_link(&tx, next, "previous_id", Some(&last), &stamp)?;
            }
        }

        let changed = tx
            .execute("DELETE FROM reminder_nodes WHERE id = ?1", params![id])
            .map_err(to_store_error)?;
        if changed == 0 {
            return Err("Reminder was not found.".to_string());
        }

        // Drop the reminder's scheduler fire record too, so deleted reminders
        // don't leave orphan dedupe rows behind (delete is the only path that
        // removes a reminder row).
        tx.execute(
            "DELETE FROM reminder_fire_state WHERE reminder_id = ?1",
            params![id],
        )
        .map_err(to_store_error)?;

        tx.commit().map_err(to_store_error)?;
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, String> {
        self.connection
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(to_store_error)
    }

    fn migrate(&self) -> Result<(), String> {
        // Fresh installs get every column (incl. recurrence_json) from the base
        // schema. The `IF NOT EXISTS` create is a no-op on existing DBs.
        self.connection
            .execute_batch(SCHEMA)
            .map_err(to_store_error)?;

        // v2: pre-existing tables predate `recurrence_json` — add it. Guarded by
        // a column check so this is idempotent and never errors on fresh installs.
        if !self.column_exists("reminder_nodes", "recurrence_json")? {
            self.connection
                .execute(
                    "ALTER TABLE reminder_nodes ADD COLUMN recurrence_json TEXT",
                    [],
                )
                .map_err(to_store_error)?;
        }

        self.connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![1, "base_reminder_nodes"],
            )
            .map_err(to_store_error)?;
        self.connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![2, "add_recurrence"],
            )
            .map_err(to_store_error)?;
        // v3: the `reminder_fire_state` table is created by the base SCHEMA above
        // (idempotent `CREATE TABLE IF NOT EXISTS`), so existing DBs pick it up on
        // the next open — only the migration marker is recorded here.
        self.connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![3, "add_reminder_fire_state"],
            )
            .map_err(to_store_error)?;

        // v4: `category` → `tags_json`, following the same state-based pattern as
        // v2 — guarded by what the table actually contains, never by the recorded
        // version. This shipped marker-only at first (base SCHEMA + an unversioned
        // marker) which did nothing at all: `CREATE TABLE IF NOT EXISTS` is a
        // no-op on an existing table, so a real v3 DB kept its `category` column,
        // gained no `tags_json`, and still recorded version 4 — claiming to be
        // migrated while every query referencing `tags_json` failed. Because the
        // guards below read the schema rather than the marker, such a DB heals
        // itself on the next open.
        if !self.column_exists("reminder_nodes", "tags_json")? {
            self.connection
                .execute(
                    "ALTER TABLE reminder_nodes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'",
                    [],
                )
                .map_err(to_store_error)?;
        }

        // Carry a real old category across as the reminder's first tag. The old
        // values were auto-guesses, but a guess the user kept beats dropping it;
        // `uncategorized` carries nothing because it never meant anything.
        // Runs only while both columns coexist, so it can't fire twice.
        if self.column_exists("reminder_nodes", "category")? {
            self.connection
                .execute(
                    r#"
                    UPDATE reminder_nodes
                    SET tags_json = '["' || category || '"]'
                    WHERE tags_json = '[]' AND category <> 'uncategorized'
                    "#,
                    [],
                )
                .map_err(to_store_error)?;
            // DROP COLUMN needs SQLite >= 3.35; libsqlite3-sys bundles well past
            // that. It is allowed here despite the column's CHECK constraint.
            self.connection
                .execute("ALTER TABLE reminder_nodes DROP COLUMN category", [])
                .map_err(to_store_error)?;
        }

        self.connection
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?1, ?2)",
                params![CURRENT_SCHEMA_VERSION, "replace_category_with_tags"],
            )
            .map_err(to_store_error)?;

        Ok(())
    }

    fn column_exists(&self, table: &str, column: &str) -> Result<bool, String> {
        let mut statement = self
            .connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(to_store_error)?;
        let mut rows = statement.query([]).map_err(to_store_error)?;
        while let Some(row) = rows.next().map_err(to_store_error)? {
            let name: String = row.get("name").map_err(to_store_error)?;
            if name == column {
                return Ok(true);
            }
        }
        Ok(false)
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
                  tags_json,
                  parent_id,
                  previous_id,
                  next_id,
                  checklist_json,
                  recurrence_json,
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
    let tags_json: String = row.get("tags_json")?;
    let tags = serde_json::from_str(&tags_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            tags_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;

    let checklist_json: String = row.get("checklist_json")?;
    let checklist = serde_json::from_str(&checklist_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            checklist_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;

    let recurrence_json: Option<String> = row.get("recurrence_json")?;
    let recurrence = match recurrence_json {
        Some(raw) if !raw.trim().is_empty() => {
            Some(serde_json::from_str(&raw).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    raw.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?)
        }
        _ => None,
    };

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
        tags,
        parent_id: row.get("parent_id")?,
        previous_id: row.get("previous_id")?,
        next_id: row.get("next_id")?,
        checklist,
        recurrence,
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

fn validate_status_patch(patch: &ReminderStatusPatch) -> Result<(), String> {
    if patch.id.trim().is_empty() {
        return Err("Reminder id is required.".to_string());
    }

    if patch.updated_at.trim().is_empty() {
        return Err("Reminder update time is required.".to_string());
    }

    if !matches!(
        patch.status.as_str(),
        "pending" | "done" | "missed" | "snoozed" | "cancelled"
    ) {
        return Err("Reminder status is not supported.".to_string());
    }

    if patch.status == "snoozed"
        && patch
            .snoozed_until
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err("Snoozed reminders require snoozedUntil.".to_string());
    }

    Ok(())
}

fn validate_edit_patch(patch: &ReminderEditPatch) -> Result<(), String> {
    if patch.id.trim().is_empty() {
        return Err("Reminder id is required.".to_string());
    }

    if patch.title.trim().is_empty() {
        return Err("Reminder title is required.".to_string());
    }

    if patch.raw_input.trim().is_empty() {
        return Err("Reminder raw input is required.".to_string());
    }

    if patch.scheduled_at.trim().is_empty() {
        return Err("Reminder scheduled time is required.".to_string());
    }

    if patch.timezone.trim().is_empty() {
        return Err("Reminder timezone is required.".to_string());
    }

    if patch.updated_at.trim().is_empty() {
        return Err("Reminder update time is required.".to_string());
    }

    if !matches!(
        patch.reminder_type.as_str(),
        "main" | "prep" | "followup" | "deadline" | "cooldown"
    ) {
        return Err("Reminder type is not supported.".to_string());
    }

    Ok(())
}

/// Max characters in one tag, and max tags per reminder. Mirrors
/// `TAG_MAX_LENGTH` / `MAX_TAGS_PER_REMINDER` in `@linodea/types` — the TS side
/// is the contract, this is the enforcement at the storage boundary.
const TAG_MAX_LENGTH: usize = 24;
const MAX_TAGS_PER_REMINDER: usize = 5;

/// Canonical form of one tag: lowercased, leading `#` stripped, punctuation and
/// spaces dropped (`-`/`_` survive), length-capped. Must start with a letter, so
/// `#2` never becomes a tag named "2". Mirrors `normalizeTag` in
/// `@linodea/types`; `char::is_alphanumeric` is Unicode-aware, matching the TS
/// side's `\p{L}\p{N}` so Indonesian tags round-trip.
///
/// Returns None for anything unusable. Normalizing rather than rejecting is
/// deliberate: tags are a low-stakes organizational hint, and a stray character
/// should not fail a save.
fn normalize_tag(raw: &str) -> Option<String> {
    let stripped = raw.trim().trim_start_matches('#').to_lowercase();
    let kept: String = stripped
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(TAG_MAX_LENGTH)
        .collect();
    let tag = kept.trim_matches(|c| c == '-' || c == '_');
    if tag.is_empty() || !tag.chars().next().is_some_and(char::is_alphabetic) {
        return None;
    }
    Some(tag.to_string())
}

/// Normalize, dedupe (first spelling wins) and cap a tag list, then serialize it
/// to the JSON stored in `tags_json`. Order is preserved so `tags[0]` stays the
/// tag the user typed first — the chain view groups on it.
fn serialize_tags(tags: &[String]) -> Result<String, String> {
    let mut normalized: Vec<String> = Vec::new();
    for raw in tags {
        if let Some(tag) = normalize_tag(raw) {
            if !normalized.contains(&tag) {
                normalized.push(tag);
            }
        }
        if normalized.len() >= MAX_TAGS_PER_REMINDER {
            break;
        }
    }
    serde_json::to_string(&normalized).map_err(to_store_error)
}

fn to_store_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Serialize an optional recurrence rule to the JSON stored in `recurrence_json`
/// (`None` → SQL NULL).
fn serialize_recurrence(recurrence: &Option<Recurrence>) -> Result<Option<String>, String> {
    match recurrence {
        Some(rule) => serde_json::to_string(rule)
            .map(Some)
            .map_err(to_store_error),
        None => Ok(None),
    }
}

/// The three chain pointers of a single node.
struct NodeLinks {
    parent: Option<String>,
    previous: Option<String>,
    next: Option<String>,
}

/// Read a node's chain pointers, or `None` if the node does not exist.
fn fetch_links(connection: &Connection, id: &str) -> Result<Option<NodeLinks>, String> {
    connection
        .query_row(
            "SELECT parent_id, previous_id, next_id FROM reminder_nodes WHERE id = ?1",
            params![id],
            |row| {
                Ok(NodeLinks {
                    parent: row.get(0)?,
                    previous: row.get(1)?,
                    next: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(to_store_error)
}

/// Set a single chain-pointer column on a node, bumping its sync bookkeeping.
/// `column` is always an internal constant — never user input.
fn set_link(
    connection: &Connection,
    id: &str,
    column: &str,
    value: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    let sql = format!(
        "UPDATE reminder_nodes SET {column} = ?2, updated_at = ?3, sync_version = sync_version + 1 WHERE id = ?1"
    );
    connection
        .execute(&sql, params![id, value, updated_at])
        .map(|_| ())
        .map_err(to_store_error)
}

/// Set all three chain pointers on a node at once.
fn set_all_links(
    connection: &Connection,
    id: &str,
    parent: Option<&str>,
    previous: Option<&str>,
    next: Option<&str>,
    updated_at: &str,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            UPDATE reminder_nodes
            SET parent_id = ?2, previous_id = ?3, next_id = ?4,
                updated_at = ?5, sync_version = sync_version + 1
            WHERE id = ?1
            "#,
            params![id, parent, previous, next, updated_at],
        )
        .map(|_| ())
        .map_err(to_store_error)
}

/// The head (previous_id IS NULL) of a sibling group, ignoring `exclude_id`
/// (the node mid-move, whose stale pointers must not be picked).
fn group_head(
    connection: &Connection,
    parent: Option<&str>,
    exclude_id: &str,
) -> Result<Option<String>, String> {
    let result = match parent {
        Some(parent) => connection.query_row(
            "SELECT id FROM reminder_nodes WHERE parent_id = ?1 AND previous_id IS NULL AND id != ?2 LIMIT 1",
            params![parent, exclude_id],
            |row| row.get(0),
        ),
        None => connection.query_row(
            "SELECT id FROM reminder_nodes WHERE parent_id IS NULL AND previous_id IS NULL AND id != ?1 LIMIT 1",
            params![exclude_id],
            |row| row.get(0),
        ),
    };
    result.optional().map_err(to_store_error)
}

/// Whether `ancestor` is found walking up the parent chain from `start`.
/// Guarded against a pre-existing parent cycle so it always terminates.
fn is_descendant(connection: &Connection, ancestor: &str, start: &str) -> Result<bool, String> {
    let mut cursor = Some(start.to_string());
    let mut guard = 0;
    while let Some(current) = cursor {
        if current == ancestor {
            return Ok(true);
        }
        guard += 1;
        if guard > 10_000 {
            break;
        }
        cursor = fetch_links(connection, &current)?.and_then(|links| links.parent);
    }
    Ok(false)
}

/// A fresh ISO-8601 UTC timestamp, matching the format the JS side sends, used
/// for the structural pointer updates a delete makes to neighbors/children.
fn now_iso(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(to_store_error)
}

/// The ids of a node's direct children, in their linked order.
fn ordered_children(connection: &Connection, parent_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT id, previous_id, next_id FROM reminder_nodes WHERE parent_id = ?1")
        .map_err(to_store_error)?;
    let rows = statement
        .query_map(params![parent_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(to_store_error)?;

    let mut members = Vec::new();
    let mut links: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for row in rows {
        let (id, previous, next) = row.map_err(to_store_error)?;
        members.push(id.clone());
        links.insert(id, (previous, next));
    }

    Ok(order_group_ids(&members, &links))
}

/// Order the ids of one sibling group by walking each chain head along its
/// `next` links. Defensive: nodes left out by broken or cyclic links are
/// appended in input order so none are ever dropped.
fn order_group_ids(
    members: &[String],
    links: &HashMap<String, (Option<String>, Option<String>)>,
) -> Vec<String> {
    let member_set: HashSet<&str> = members.iter().map(String::as_str).collect();
    let mut visited: HashSet<String> = HashSet::new();
    let mut ordered = Vec::with_capacity(members.len());

    for candidate in members {
        let previous = links
            .get(candidate)
            .and_then(|(previous, _)| previous.as_deref());
        let is_head = match previous {
            None => true,
            Some(previous) => !member_set.contains(previous),
        };
        if !is_head {
            continue;
        }
        let mut cursor = Some(candidate.clone());
        while let Some(current) = cursor {
            if !visited.insert(current.clone()) {
                break;
            }
            ordered.push(current.clone());
            cursor = links
                .get(&current)
                .and_then(|(_, next)| next.clone())
                .filter(|next| member_set.contains(next.as_str()) && !visited.contains(next));
        }
    }

    for candidate in members {
        if visited.insert(candidate.clone()) {
            ordered.push(candidate.clone());
        }
    }

    ordered
}

/// Build the nested chain forest from a flat node list. Pure (no DB), so the
/// ordering and defensive rules are unit-testable on crafted inputs.
fn assemble_chains(nodes: Vec<ReminderNode>) -> Vec<ChainNode> {
    let order: Vec<String> = nodes.iter().map(|node| node.id.clone()).collect();
    let mut index: HashMap<String, ReminderNode> = HashMap::with_capacity(nodes.len());
    for node in nodes {
        index.insert(node.id.clone(), node);
    }

    let present: HashSet<String> = index.keys().cloned().collect();
    let mut groups: HashMap<Option<String>, Vec<String>> = HashMap::new();
    let mut links: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    for id in &order {
        let node = &index[id];
        // A parent pointing at a missing node is treated as a root.
        let parent = match node.parent_id.as_deref() {
            Some(parent) if present.contains(parent) => Some(parent.to_string()),
            _ => None,
        };
        groups.entry(parent).or_default().push(id.clone());
        links.insert(id.clone(), (node.previous_id.clone(), node.next_id.clone()));
    }

    let mut visited: HashSet<String> = HashSet::new();
    let mut roots = build_chain_level(None, &groups, &links, &index, &mut visited);

    // Salvage any node trapped under a parent cycle (e.g. self-parent) so the
    // forest still contains every node exactly once.
    for id in &order {
        if visited.insert(id.clone()) {
            let children = build_chain_level(Some(id), &groups, &links, &index, &mut visited);
            roots.push(ChainNode {
                node: index[id].clone(),
                children,
            });
        }
    }

    roots
}

fn build_chain_level(
    parent: Option<&str>,
    groups: &HashMap<Option<String>, Vec<String>>,
    links: &HashMap<String, (Option<String>, Option<String>)>,
    index: &HashMap<String, ReminderNode>,
    visited: &mut HashSet<String>,
) -> Vec<ChainNode> {
    let key = parent.map(|parent| parent.to_string());
    let members = match groups.get(&key) {
        Some(members) => members,
        None => return Vec::new(),
    };

    let mut level = Vec::new();
    for id in order_group_ids(members, links) {
        if !visited.insert(id.clone()) {
            continue;
        }
        let children = build_chain_level(Some(&id), groups, links, index, visited);
        level.push(ChainNode {
            node: index[&id].clone(),
            children,
        });
    }
    level
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

    #[test]
    fn records_current_schema_version() {
        let store = ReminderStore::open_in_memory().expect("store opens");

        let version = store.schema_version().expect("schema version exists");

        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn lists_due_pending_and_due_snoozed_reminders() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("due-pending"))
            .expect("due pending reminder is created");

        let mut future = sample_reminder("future-pending");
        future.scheduled_at = "2026-05-22T13:30:00.000Z".to_string();
        store
            .create_reminder(future)
            .expect("future pending reminder is created");

        let mut snoozed = sample_reminder("due-snoozed");
        snoozed.status = "snoozed".to_string();
        snoozed.snoozed_until = Some("2026-05-22T12:10:00.000Z".to_string());
        store
            .create_reminder(snoozed)
            .expect("due snoozed reminder is created");

        let due = store
            .list_due_reminders("2026-05-22T12:31:00.000Z")
            .expect("due reminders are listed");

        assert_eq!(due.len(), 2);
        assert_eq!(due[0].id, "due-snoozed");
        assert_eq!(due[1].id, "due-pending");
    }

    #[test]
    fn updates_status_and_increments_sync_version() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("reminder-1"))
            .expect("reminder is created");

        let updated = store
            .update_reminder_status(ReminderStatusPatch {
                id: "reminder-1".to_string(),
                status: "done".to_string(),
                updated_at: "2026-05-22T12:45:00.000Z".to_string(),
                completed_at: None,
                snoozed_until: None,
            })
            .expect("reminder status is updated");

        assert_eq!(updated.status, "done");
        assert_eq!(
            updated.completed_at,
            Some("2026-05-22T12:45:00.000Z".to_string())
        );
        assert_eq!(updated.sync_version, 1);
    }

    #[test]
    fn rejects_snoozed_status_without_snooze_time() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("reminder-1"))
            .expect("reminder is created");

        let result = store.update_reminder_status(ReminderStatusPatch {
            id: "reminder-1".to_string(),
            status: "snoozed".to_string(),
            updated_at: "2026-05-22T12:45:00.000Z".to_string(),
            completed_at: None,
            snoozed_until: None,
        });

        assert!(result.is_err());
    }

    #[test]
    fn updates_editable_fields_and_bumps_sync_version() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("reminder-1"))
            .expect("reminder is created");

        let updated = store
            .update_reminder(ReminderEditPatch {
                id: "reminder-1".to_string(),
                title: "Submit grant form".to_string(),
                raw_input: "besok jam 9 pagi submit grant form".to_string(),
                scheduled_at: "2026-05-23T02:00:00.000Z".to_string(),
                timezone: "Asia/Jakarta".to_string(),
                reminder_type: "deadline".to_string(),
                tags: vec!["skripsi".to_string()],
                checklist: vec!["draft".to_string()],
                recurrence: None,
                updated_at: "2026-05-22T13:00:00.000Z".to_string(),
            })
            .expect("reminder is edited");

        assert_eq!(updated.title, "Submit grant form");
        assert_eq!(updated.scheduled_at, "2026-05-23T02:00:00.000Z");
        assert_eq!(updated.reminder_type, "deadline");
        assert_eq!(updated.tags, vec!["skripsi"]);
        assert_eq!(updated.checklist, vec!["draft"]);
        assert_eq!(updated.sync_version, 1);
        // Status/created fields are untouched by an edit.
        assert_eq!(updated.status, "pending");
        assert_eq!(updated.created_at, "2026-05-22T12:00:00.000Z");
    }

    #[test]
    fn update_normalizes_tags_instead_of_rejecting_them() {
        // The old `category` column was a CHECK-constrained enum, so an unknown
        // value was an error. Tags are open-ended user text, so the storage
        // boundary normalizes instead: a stray `#`, casing, and a duplicate all
        // get cleaned rather than failing the save.
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("reminder-1"))
            .expect("reminder is created");

        let updated = store
            .update_reminder(ReminderEditPatch {
                id: "reminder-1".to_string(),
                title: "Whatever".to_string(),
                raw_input: "in 1h whatever".to_string(),
                scheduled_at: "2026-05-22T13:30:00.000Z".to_string(),
                timezone: "Asia/Jakarta".to_string(),
                reminder_type: "main".to_string(),
                tags: vec![
                    "#Kerja".to_string(),
                    "kerja".to_string(),
                    "  rapat tim ".to_string(),
                    "2".to_string(),
                ],
                checklist: vec![],
                recurrence: None,
                updated_at: "2026-05-22T13:00:00.000Z".to_string(),
            })
            .expect("reminder is edited");

        // "#Kerja" → "kerja"; the duplicate collapses; spaces are dropped from
        // "rapat tim"; a leading-digit "2" is not a tag at all.
        assert_eq!(updated.tags, vec!["kerja", "rapattim"]);
    }

    #[test]
    fn serialize_tags_caps_the_list() {
        let many: Vec<String> = ["a", "b", "c", "d", "e", "f", "g"]
            .iter()
            .map(|t| t.to_string())
            .collect();

        assert_eq!(
            serialize_tags(&many).expect("serializes"),
            r#"["a","b","c","d","e"]"#
        );
    }

    #[test]
    fn normalize_tag_rejects_non_letter_starts_and_empties() {
        assert_eq!(normalize_tag("#skripsi"), Some("skripsi".to_string()));
        assert_eq!(normalize_tag("saham-bbca"), Some("saham-bbca".to_string()));
        // Trailing separators are trimmed, not kept.
        assert_eq!(normalize_tag("kerja__"), Some("kerja".to_string()));
        assert_eq!(normalize_tag("2"), None);
        assert_eq!(normalize_tag("#"), None);
        assert_eq!(normalize_tag("   "), None);
        // Unicode letters are allowed, so Indonesian tags round-trip.
        assert_eq!(normalize_tag("#Ulangan"), Some("ulangan".to_string()));
    }

    #[test]
    fn deletes_a_reminder() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("reminder-1"))
            .expect("reminder is created");

        store
            .delete_reminder("reminder-1")
            .expect("reminder is deleted");
        assert_eq!(store.list_reminders().expect("lists").len(), 0);

        // Deleting again is an error (nothing to remove).
        assert!(store.delete_reminder("reminder-1").is_err());
    }

    #[test]
    fn round_trips_a_recurring_reminder() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        let mut reminder = sample_reminder("weekly-standup");
        reminder.recurrence = Some(Recurrence {
            freq: "weekly".to_string(),
            interval: 1,
            weekday: Some(1),
            count: Some(6),
        });

        store.create_reminder(reminder).expect("created");
        let read = store.list_reminders().expect("listed");

        let rule = read[0].recurrence.as_ref().expect("recurrence persisted");
        assert_eq!(rule.freq, "weekly");
        assert_eq!(rule.interval, 1);
        assert_eq!(rule.weekday, Some(1));
        assert_eq!(rule.count, Some(6));
    }

    #[test]
    fn advances_a_recurrence_to_the_next_occurrence() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        let mut reminder = sample_reminder("daily-water");
        reminder.recurrence = Some(Recurrence {
            freq: "daily".to_string(),
            interval: 1,
            weekday: None,
            count: Some(3),
        });
        store.create_reminder(reminder).expect("created");

        let advanced = store
            .advance_reminder_recurrence(AdvanceRecurrencePatch {
                id: "daily-water".to_string(),
                scheduled_at: "2026-05-23T12:30:00.000Z".to_string(),
                recurrence: Some(Recurrence {
                    freq: "daily".to_string(),
                    interval: 1,
                    weekday: None,
                    count: Some(2),
                }),
                updated_at: "2026-05-22T12:30:00.000Z".to_string(),
            })
            .expect("advanced");

        assert_eq!(advanced.scheduled_at, "2026-05-23T12:30:00.000Z");
        assert_eq!(advanced.status, "pending");
        assert_eq!(advanced.completed_at, None);
        assert_eq!(advanced.recurrence.expect("rule").count, Some(2));
        assert_eq!(advanced.sync_version, 1);
    }

    #[test]
    fn migrates_v1_table_by_adding_recurrence_column() {
        // Simulate a v1 DB: reminder_nodes WITHOUT recurrence_json, a row, and a
        // recorded version-1 migration. Then run migrate() and confirm the
        // column is added and the existing row still loads.
        //
        // The seeded table carries `tags_json`, not the real v1 `category`: v4
        // deliberately ships no category→tags backfill (pre-launch, one DB in
        // existence), so a genuine v1 row is not loadable by design. What this
        // test pins is the recurrence_json ALTER — the state-based `column_exists`
        // guard that a version-skipping user cannot miss.
        let connection = Connection::open_in_memory().expect("opens");
        connection
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations (
                  version INTEGER PRIMARY KEY,
                  name TEXT NOT NULL,
                  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE TABLE reminder_nodes (
                  id TEXT PRIMARY KEY,
                  user_id TEXT,
                  title TEXT NOT NULL,
                  raw_input TEXT NOT NULL,
                  description TEXT,
                  scheduled_at TEXT NOT NULL,
                  timezone TEXT NOT NULL,
                  reminder_type TEXT NOT NULL,
                  status TEXT NOT NULL,
                  tags_json TEXT NOT NULL,
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
                INSERT INTO schema_migrations (version, name) VALUES (1, 'base_reminder_nodes');
                INSERT INTO reminder_nodes (
                  id, title, raw_input, scheduled_at, timezone, reminder_type, status,
                  tags_json, checklist_json, confidence, created_at, updated_at,
                  created_on_device_id, sync_version
                ) VALUES (
                  'legacy-1', 'Old reminder', 'in 30m old reminder',
                  '2026-05-22T12:30:00.000Z', 'Asia/Jakarta', 'main', 'pending',
                  '[]', '["logs"]', 0.9, '2026-05-22T12:00:00.000Z',
                  '2026-05-22T12:00:00.000Z', 'device-1', 0
                );
                "#,
            )
            .expect("v1 schema seeded");

        let store = ReminderStore {
            connection,
            database_path: PathBuf::from(":memory:"),
        };
        assert!(!store
            .column_exists("reminder_nodes", "recurrence_json")
            .expect("checks column"));

        store.migrate().expect("migration runs");

        assert!(store
            .column_exists("reminder_nodes", "recurrence_json")
            .expect("checks column"));
        assert_eq!(
            store.schema_version().expect("version"),
            CURRENT_SCHEMA_VERSION
        );
        // v3 adds the fire-state table; a migrated v1 DB gets it too, and its
        // fire store starts empty.
        assert!(store
            .get_fire_records()
            .expect("fire records read")
            .is_empty());

        let reminders = store.list_reminders().expect("legacy row still loads");
        assert_eq!(reminders.len(), 1);
        assert_eq!(reminders[0].id, "legacy-1");
        assert!(reminders[0].recurrence.is_none());
    }

    #[test]
    fn heals_a_db_left_half_migrated_by_the_marker_only_v4() {
        // The first v4 shipped as a marker with no ALTER, so a real v3 DB kept
        // `category`, never gained `tags_json`, and still recorded version 4 —
        // it *claimed* to be migrated while every query failed. Reproduce that
        // exact state and prove the state-based guards heal it, marker and all.
        let connection = Connection::open_in_memory().expect("opens");
        connection
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations (
                  version INTEGER PRIMARY KEY,
                  name TEXT NOT NULL,
                  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                );
                CREATE TABLE reminder_nodes (
                  id TEXT PRIMARY KEY,
                  user_id TEXT,
                  title TEXT NOT NULL,
                  raw_input TEXT NOT NULL,
                  description TEXT,
                  scheduled_at TEXT NOT NULL,
                  timezone TEXT NOT NULL,
                  reminder_type TEXT NOT NULL,
                  status TEXT NOT NULL,
                  category TEXT NOT NULL CHECK (
                    category IN ('university', 'investing', 'personal',
                                 'tutoring', 'urgent', 'waiting', 'uncategorized')
                  ),
                  parent_id TEXT,
                  previous_id TEXT,
                  next_id TEXT,
                  checklist_json TEXT NOT NULL,
                  recurrence_json TEXT,
                  confidence REAL NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  completed_at TEXT,
                  snoozed_until TEXT,
                  created_on_device_id TEXT NOT NULL,
                  sync_version INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO schema_migrations (version, name) VALUES
                  (1, 'base_reminder_nodes'), (2, 'add_recurrence'),
                  (3, 'add_reminder_fire_state'), (4, 'replace_category_with_tags');
                INSERT INTO reminder_nodes (
                  id, title, raw_input, scheduled_at, timezone, reminder_type, status,
                  category, checklist_json, confidence, created_at, updated_at,
                  created_on_device_id, sync_version
                ) VALUES
                  ('kept', 'Biology project', 'deadline biology project',
                   '2026-05-22T12:30:00.000Z', 'Asia/Jakarta', 'deadline', 'pending',
                   'uncategorized', '[]', 0.9, '2026-05-22T12:00:00.000Z',
                   '2026-05-22T12:00:00.000Z', 'device-1', 0),
                  ('tagged', 'Read chapter 3', 'besok jam 8 read chapter 3',
                   '2026-05-22T13:30:00.000Z', 'Asia/Jakarta', 'main', 'pending',
                   'university', '[]', 0.9, '2026-05-22T12:00:00.000Z',
                   '2026-05-22T12:00:00.000Z', 'device-1', 0);
                "#,
            )
            .expect("half-migrated schema seeded");

        let store = ReminderStore {
            connection,
            database_path: PathBuf::from(":memory:"),
        };
        // Precondition: the marker lies.
        assert_eq!(store.schema_version().expect("version"), 4);
        assert!(!store.column_exists("reminder_nodes", "tags_json").unwrap());
        assert!(store.column_exists("reminder_nodes", "category").unwrap());

        store.migrate().expect("migration heals the DB");

        assert!(store.column_exists("reminder_nodes", "tags_json").unwrap());
        assert!(!store.column_exists("reminder_nodes", "category").unwrap());

        let mut reminders = store.list_reminders().expect("rows still load");
        reminders.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(reminders.len(), 2);
        // A real old category is carried across as the first tag...
        assert_eq!(reminders[1].tags, vec!["university"]);
        // ...but `uncategorized` never meant anything, so it carries nothing.
        assert!(reminders[0].tags.is_empty());

        // Idempotent: a second open must be a clean no-op.
        store.migrate().expect("second migration is a no-op");
        assert!(store.column_exists("reminder_nodes", "tags_json").unwrap());
    }

    #[test]
    fn upserts_reads_and_clears_fire_records() {
        let store = ReminderStore::open_in_memory().expect("store opens");

        // Empty to start.
        assert!(store.get_fire_records().expect("read").is_empty());

        // Insert a prealert-only record, then upsert it to add the due flag.
        store
            .set_fire_record(
                "r1".to_string(),
                FireRecord {
                    due: false,
                    prealerts: vec![1440, 60],
                },
            )
            .expect("set prealerts");
        store
            .set_fire_record(
                "r1".to_string(),
                FireRecord {
                    due: true,
                    prealerts: vec![1440, 60],
                },
            )
            .expect("upsert due");

        let records = store.get_fire_records().expect("read");
        assert_eq!(records.len(), 1);
        let record = &records["r1"];
        assert!(record.due);
        assert_eq!(record.prealerts, vec![1440, 60]);

        // Clearing removes it; clearing again is a harmless no-op.
        store.clear_fire_record("r1").expect("clear");
        assert!(store.get_fire_records().expect("read").is_empty());
        store.clear_fire_record("r1").expect("clear no-op");
    }

    #[test]
    fn deleting_a_reminder_drops_its_fire_record() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("r1"))
            .expect("reminder is created");
        store
            .set_fire_record(
                "r1".to_string(),
                FireRecord {
                    due: true,
                    prealerts: vec![],
                },
            )
            .expect("set");

        store.delete_reminder("r1").expect("reminder is deleted");

        assert!(store.get_fire_records().expect("read").is_empty());
    }

    const MOVE_STAMP: &str = "2026-05-22T13:00:00.000Z";

    fn move_patch(id: &str, parent: Option<&str>, after: Option<&str>) -> MovePatch {
        MovePatch {
            id: id.to_string(),
            parent_id: parent.map(str::to_string),
            after_id: after.map(str::to_string),
            updated_at: MOVE_STAMP.to_string(),
        }
    }

    fn seed(store: &ReminderStore, ids: &[&str]) {
        for id in ids {
            store
                .create_reminder(sample_reminder(id))
                .expect("reminder is created");
        }
    }

    /// Flatten one assembled level into `(id, child_ids)` pairs for assertions.
    fn level(chains: &[ChainNode]) -> Vec<(String, Vec<String>)> {
        chains
            .iter()
            .map(|chain| {
                (
                    chain.node.id.clone(),
                    chain.children.iter().map(|c| c.node.id.clone()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn moves_a_reminder_under_a_parent_and_nests_it() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["main", "prep"]);

        store
            .move_reminder(move_patch("prep", Some("main"), None))
            .expect("prep nests under main");

        let chains = store.list_reminder_chains().expect("chains assemble");
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].node.id, "main");
        let children: Vec<_> = chains[0]
            .children
            .iter()
            .map(|c| c.node.id.clone())
            .collect();
        assert_eq!(children, vec!["prep"]);
    }

    #[test]
    fn orders_and_reorders_siblings() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["p", "c1", "c2", "c3"]);

        store
            .move_reminder(move_patch("c1", Some("p"), None))
            .expect("c1");
        store
            .move_reminder(move_patch("c2", Some("p"), Some("c1")))
            .expect("c2");
        store
            .move_reminder(move_patch("c3", Some("p"), Some("c2")))
            .expect("c3");

        let chains = store.list_reminder_chains().expect("chains assemble");
        let children: Vec<_> = chains[0]
            .children
            .iter()
            .map(|c| c.node.id.clone())
            .collect();
        assert_eq!(children, vec!["c1", "c2", "c3"]);

        // Move c3 to the head of the group.
        store
            .move_reminder(move_patch("c3", Some("p"), None))
            .expect("reorder");
        let chains = store.list_reminder_chains().expect("chains assemble");
        let children: Vec<_> = chains[0]
            .children
            .iter()
            .map(|c| c.node.id.clone())
            .collect();
        assert_eq!(children, vec!["c3", "c1", "c2"]);
    }

    #[test]
    fn moving_to_root_detaches_from_the_parent() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["main", "prep"]);
        store
            .move_reminder(move_patch("prep", Some("main"), None))
            .expect("nest");

        store
            .move_reminder(move_patch("prep", None, None))
            .expect("unlink to root");

        let chains = store.list_reminder_chains().expect("chains assemble");
        assert_eq!(chains.len(), 2);
        assert!(chains.iter().all(|chain| chain.children.is_empty()));
    }

    #[test]
    fn rejects_self_parenting() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["x"]);
        assert!(store
            .move_reminder(move_patch("x", Some("x"), None))
            .is_err());
    }

    #[test]
    fn rejects_a_parent_cycle() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["p", "c"]);
        store
            .move_reminder(move_patch("c", Some("p"), None))
            .expect("nest c under p");

        // Making p a child of its own descendant c would cycle.
        assert!(store
            .move_reminder(move_patch("p", Some("c"), None))
            .is_err());
    }

    #[test]
    fn rejects_after_sibling_from_a_different_group() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["a", "b", "c"]);
        store
            .move_reminder(move_patch("b", Some("a"), None))
            .expect("b under a");

        // c at root cannot be placed after b, which lives under a.
        assert!(store
            .move_reminder(move_patch("c", None, Some("b")))
            .is_err());
    }

    #[test]
    fn delete_promotes_children_into_the_gap() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["r1", "p", "r2", "c1", "c2"]);
        // Root chain: r1 -> p -> r2.
        store
            .move_reminder(move_patch("p", None, Some("r1")))
            .expect("p after r1");
        store
            .move_reminder(move_patch("r2", None, Some("p")))
            .expect("r2 after p");
        // p's children: c1 -> c2.
        store
            .move_reminder(move_patch("c1", Some("p"), None))
            .expect("c1 under p");
        store
            .move_reminder(move_patch("c2", Some("p"), Some("c1")))
            .expect("c2 under p");

        store.delete_reminder("p").expect("p is deleted");

        let chains = store.list_reminder_chains().expect("chains assemble");
        assert_eq!(
            level(&chains),
            vec![
                ("r1".to_string(), vec![]),
                ("c1".to_string(), vec![]),
                ("c2".to_string(), vec![]),
                ("r2".to_string(), vec![]),
            ]
        );
    }

    #[test]
    fn delete_stitches_sibling_links() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        seed(&store, &["a", "b", "c"]);
        store
            .move_reminder(move_patch("b", None, Some("a")))
            .expect("a -> b");
        store
            .move_reminder(move_patch("c", None, Some("b")))
            .expect("b -> c");

        store.delete_reminder("b").expect("b is deleted");

        let chains = store.list_reminder_chains().expect("chains assemble");
        let ids: Vec<_> = chains.iter().map(|chain| chain.node.id.clone()).collect();
        assert_eq!(ids, vec!["a", "c"]);
    }

    #[test]
    fn assembly_orders_by_links_not_schedule() {
        // b is scheduled before a, but the links say a -> b.
        let mut a = sample_reminder("a");
        a.next_id = Some("b".to_string());
        a.scheduled_at = "2026-05-22T15:00:00.000Z".to_string();
        let mut b = sample_reminder("b");
        b.previous_id = Some("a".to_string());
        b.scheduled_at = "2026-05-22T09:00:00.000Z".to_string();

        let chains = assemble_chains(vec![b, a]);
        let ids: Vec<_> = chains.iter().map(|chain| chain.node.id.clone()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn assembly_surfaces_an_orphan_at_root() {
        let mut child = sample_reminder("child");
        child.parent_id = Some("ghost".to_string());

        let chains = assemble_chains(vec![child]);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].node.id, "child");
    }

    #[test]
    fn assembly_is_defensive_against_a_link_cycle() {
        let mut a = sample_reminder("a");
        a.next_id = Some("b".to_string());
        let mut b = sample_reminder("b");
        b.previous_id = Some("a".to_string());
        b.next_id = Some("a".to_string()); // cycle back to a

        let chains = assemble_chains(vec![a, b]);
        let ids: Vec<_> = chains.iter().map(|chain| chain.node.id.clone()).collect();
        assert_eq!(ids, vec!["a", "b"]);
    }

    #[test]
    fn assembly_salvages_a_self_parented_node() {
        let mut x = sample_reminder("x");
        x.parent_id = Some("x".to_string());

        let chains = assemble_chains(vec![x]);
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].node.id, "x");
        assert!(chains[0].children.is_empty());
    }

    #[test]
    fn sets_reminder_tags() {
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("r1"))
            .expect("reminder is created");

        let updated = store
            .set_reminder_tags(ReminderTagsPatch {
                id: "r1".to_string(),
                tags: vec!["saham".to_string(), "#Riset".to_string()],
                updated_at: "2026-05-22T13:00:00.000Z".to_string(),
            })
            .expect("tags are set");

        assert_eq!(updated.tags, vec!["saham", "riset"]);
        assert_eq!(updated.sync_version, 1);
    }

    #[test]
    fn set_tags_can_clear_them() {
        // Untagging is a normal operation, not an error — an empty list is how
        // the chain view's "clear tags" works.
        let store = ReminderStore::open_in_memory().expect("store opens");
        store
            .create_reminder(sample_reminder("r1"))
            .expect("reminder is created");

        let updated = store
            .set_reminder_tags(ReminderTagsPatch {
                id: "r1".to_string(),
                tags: vec![],
                updated_at: "2026-05-22T13:00:00.000Z".to_string(),
            })
            .expect("tags are cleared");

        assert!(updated.tags.is_empty());
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
            tags: vec![],
            parent_id: None,
            previous_id: None,
            next_id: None,
            checklist: vec!["logs".to_string()],
            recurrence: None,
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
