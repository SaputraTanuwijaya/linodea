//! What a paired phone is told, and what it is deliberately not told.
//!
//! This is the first thing in the project that puts a user's own words on a
//! network, so the shape is a decision rather than a detail.
//!
//! ## What crosses
//!
//! Title, fire time, status, `#tags` and the chain links. That is enough for
//! the phone to raise an alarm that says what it is for, to list what is
//! coming, and to draw a chain. **Notes, checklists and the raw captured text
//! never leave the desktop** — the phone's job is to get someone back to their
//! PC, not to be a second reader of everything they wrote. The notification
//! itself shows only title and time; the richer fields exist for the in-app
//! list and chain view.
//!
//! The asymmetry is the reason for erring small: adding a field later is a
//! protocol bump, which this design already supports. Removing one after a
//! shipped phone reads it is a breaking change for a device that updates on its
//! own schedule.
//!
//! ## One occurrence, not an expansion
//!
//! A recurring reminder is sent with the single `scheduled_at` the database
//! holds, plus its rule as **display text only**. The desktop deliberately does
//! not project future occurrences, because it does not compute them either:
//! `addRecurrenceInterval` lives in `@linodea/parser`, is timezone-aware, and
//! runs on the frontend when a reminder fires. Re-deriving that here would mean
//! a second implementation of monthly and weekly arithmetic, which is exactly
//! the drift this design avoids by refusing to let the phone expand rules.
//!
//! The cost is real and worth stating: while the desktop is off, nothing
//! advances a recurring reminder, so a phone that has already fired the stored
//! occurrence has nothing further until it can pull again.
//!
//! ## Full replacement, not a delta
//!
//! Every pull returns the complete picture inside the horizon. The phone drops
//! what it had and re-arms from what it got. Deletion, completion, snoozing and
//! editing then need no protocol of their own — a reminder that stops being
//! sent simply stops being scheduled. A delta protocol would need tombstones,
//! ordering and a way to recover from a missed message, all to avoid re-sending
//! a list that is a few kilobytes.

use std::collections::HashMap;

use serde::Serialize;

use crate::data::{Recurrence, ReminderNode};

/// How far ahead the phone is told about.
///
/// Long enough that a phone kept off this network for a week still has alarms
/// armed; short enough to bound both the payload and the number of exact alarms
/// Android is asked to hold. A reminder two months out does not need to occupy
/// an alarm slot today — the phone will be told about it well before then.
pub const HORIZON_DAYS: i64 = 14;

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// One reminder as the phone sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledReminder {
    pub id: String,
    pub title: String,
    pub status: String,
    pub tags: Vec<String>,
    /// Root of the chain this belongs to; `null` for a standalone reminder.
    pub chain_id: Option<String>,
    pub previous_id: Option<String>,
    pub next_id: Option<String>,
    /// When the phone should raise an alarm.
    ///
    /// `null` means "do not schedule this" — it is present only so a chain can
    /// be drawn without holes, which happens when a sibling is already done or
    /// falls outside the horizon.
    pub fire_at_ms: Option<i64>,
    /// The repeat rule, for the phone to *show*. It is never expanded, here or
    /// there; see the module docs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence: Option<Recurrence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub protocol: u32,
    pub generated_at_ms: i64,
    pub horizon_days: i64,
    /// Minutes-before-due at which the desktop also alerts. Sent so the phone
    /// raises the same set of alerts the desktop does — without it a phone
    /// would silently drop every early warning and look like it was firing late.
    pub prealert_offsets_minutes: Vec<i64>,
    pub reminders: Vec<ScheduledReminder>,
}

/// Epoch millis for an ISO-8601 instant, or `None` if it will not parse.
///
/// Stored times are `Date.prototype.toISOString()` output, so UTC with a `Z`.
/// Parsed rather than sliced because a malformed row must be skipped, not
/// turned into a wrong alarm — and a wrong alarm is worse than a missing one,
/// since it is indistinguishable from the app working.
fn instant_ms(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|parsed| parsed.timestamp_millis())
}

/// When this reminder should wake the phone, if it should at all.
///
/// A snoozed reminder is due at its snooze time, which is the same rule the
/// desktop's own due query uses — otherwise snoozing on the desktop would leave
/// the phone ringing at the original time.
fn fire_at(reminder: &ReminderNode) -> Option<i64> {
    match reminder.status.as_str() {
        "pending" => instant_ms(&reminder.scheduled_at),
        "snoozed" => reminder.snoozed_until.as_deref().and_then(instant_ms),
        // done, cancelled, missed: nothing left to fire. A missed reminder has
        // already had its moment, and re-firing it on the phone hours later
        // would be a notification for something the desktop already gave up on.
        _ => None,
    }
}

/// A stable id shared by every member of one chain, or `None` when a reminder
/// stands alone.
///
/// `parent_id` groups a *level* of the forest; `previous_id`/`next_id` order
/// siblings within it. So `[Prep] -> [Main] -> [Follow-up]` at the top level is
/// three nodes with no parent at all, and the only thing they have in common is
/// the run itself. The head of that run is therefore the identifier: walking
/// back to it makes every member report the same value, which is what lets the
/// phone group them without being sent a chain object.
fn chain_of(reminder: &ReminderNode, by_id: &HashMap<&str, &ReminderNode>) -> Option<String> {
    if reminder.parent_id.is_none() && reminder.previous_id.is_none() && reminder.next_id.is_none()
    {
        return None;
    }

    let mut head = reminder;
    // Chains are user-editable, so a corrupt `previous_id` cycle is possible.
    // Bounding by the population means a bad link degrades to an odd grouping
    // rather than hanging the server thread that serves every phone request.
    for _ in 0..by_id.len() {
        let Some(previous) = head.previous_id.as_deref() else {
            break;
        };
        let Some(node) = by_id.get(previous) else {
            break;
        };
        head = node;
    }
    Some(head.id.clone())
}

fn view(
    reminder: &ReminderNode,
    fire_at_ms: Option<i64>,
    by_id: &HashMap<&str, &ReminderNode>,
) -> ScheduledReminder {
    ScheduledReminder {
        id: reminder.id.clone(),
        title: reminder.title.clone(),
        status: reminder.status.clone(),
        tags: reminder.tags.clone(),
        chain_id: chain_of(reminder, by_id),
        previous_id: reminder.previous_id.clone(),
        next_id: reminder.next_id.clone(),
        fire_at_ms,
        recurrence: reminder.recurrence.clone(),
    }
}

/// Build what a phone is handed.
///
/// `reminders` is the whole table; filtering happens here rather than in SQL so
/// the rules stay readable and testable in one place, and because the chain
/// closure below needs to see rows that the firing filter already rejected.
pub fn build(
    reminders: &[ReminderNode],
    now_ms: i64,
    horizon_days: i64,
    prealert_offsets_minutes: Vec<i64>,
    protocol: u32,
) -> Schedule {
    let horizon_end = now_ms + horizon_days * MS_PER_DAY;
    let by_id: HashMap<&str, &ReminderNode> = reminders
        .iter()
        .map(|reminder| (reminder.id.as_str(), reminder))
        .collect();

    // Anything that should wake the phone inside the window. Times already past
    // are dropped: the desktop handles a missed reminder its own way, and an
    // alarm set for yesterday either fires instantly or not at all.
    let firing: Vec<(&ReminderNode, i64)> = reminders
        .iter()
        .filter_map(|reminder| {
            let at = fire_at(reminder)?;
            (at >= now_ms && at <= horizon_end).then_some((reminder, at))
        })
        .collect();

    // Chains are sent whole. A chain view with holes in it -- a "Prep" step
    // missing because it is already done -- reads as data loss rather than as
    // progress, so a chain with any firing member brings its siblings along,
    // each with no fire time of its own.
    let chains: Vec<String> = {
        let mut seen: Vec<String> = Vec::new();
        for (reminder, _) in &firing {
            if let Some(chain) = chain_of(reminder, &by_id) {
                if !seen.contains(&chain) {
                    seen.push(chain);
                }
            }
        }
        seen
    };

    let mut out: Vec<ScheduledReminder> = Vec::new();
    for reminder in reminders {
        let firing_at = firing
            .iter()
            .find(|(candidate, _)| candidate.id == reminder.id)
            .map(|(_, at)| *at);

        let in_sent_chain = chain_of(reminder, &by_id)
            .map(|chain| chains.contains(&chain))
            .unwrap_or(false);

        if firing_at.is_some() || in_sent_chain {
            out.push(view(reminder, firing_at, &by_id));
        }
    }

    // Soonest first, and stable for everything that does not fire, so the phone
    // can render the list in the order it arrives.
    out.sort_by(|a, b| match (a.fire_at_ms, b.fire_at_ms) {
        (Some(left), Some(right)) => left.cmp(&right),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    Schedule {
        protocol,
        generated_at_ms: now_ms,
        horizon_days,
        prealert_offsets_minutes,
        reminders: out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

    fn at(offset_days: f64) -> String {
        let ms = NOW + (offset_days * MS_PER_DAY as f64) as i64;
        chrono::DateTime::from_timestamp_millis(ms)
            .expect("in range")
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    fn reminder(id: &str, title: &str, scheduled_at: String) -> ReminderNode {
        ReminderNode {
            id: id.to_string(),
            user_id: None,
            title: title.to_string(),
            raw_input: format!("{title} -- raw capture text"),
            description: Some("private notes".to_string()),
            scheduled_at,
            timezone: "Asia/Jakarta".to_string(),
            reminder_type: "task".to_string(),
            status: "pending".to_string(),
            tags: vec![],
            parent_id: None,
            previous_id: None,
            next_id: None,
            checklist: vec!["a secret step".to_string()],
            recurrence: None,
            confidence: 1.0,
            created_at: at(-1.0),
            updated_at: at(-1.0),
            completed_at: None,
            snoozed_until: None,
            created_on_device_id: "desktop".to_string(),
            sync_version: 1,
        }
    }

    fn build_default(reminders: &[ReminderNode]) -> Schedule {
        build(reminders, NOW, HORIZON_DAYS, vec![1440, 60], 1)
    }

    #[test]
    fn notes_checklists_and_raw_capture_never_leave_the_desktop() {
        // The privacy decision, pinned. These three fields carry the most and
        // are needed least -- an alarm does not require them. If a future change
        // adds them, it should have to delete this test on purpose.
        let schedule = build_default(&[reminder("a", "Kumpul draft skripsi", at(1.0))]);
        let json = serde_json::to_string(&schedule).expect("serializes");

        assert!(
            !json.contains("private notes"),
            "description leaked: {json}"
        );
        assert!(!json.contains("a secret step"), "checklist leaked: {json}");
        assert!(
            !json.contains("raw capture text"),
            "raw input leaked: {json}"
        );
        assert!(
            json.contains("Kumpul draft skripsi"),
            "title should be sent"
        );
    }

    #[test]
    fn a_pending_reminder_inside_the_horizon_is_scheduled() {
        let schedule = build_default(&[reminder("a", "Rapat pagi", at(1.0))]);
        assert_eq!(schedule.reminders.len(), 1);
        assert_eq!(schedule.reminders[0].fire_at_ms, Some(NOW + MS_PER_DAY));
        assert_eq!(schedule.prealert_offsets_minutes, vec![1440, 60]);
        assert_eq!(schedule.horizon_days, HORIZON_DAYS);
    }

    #[test]
    fn reminders_past_the_horizon_are_left_for_a_later_pull() {
        let schedule = build_default(&[
            reminder("near", "Besok", at(13.0)),
            reminder("far", "Bulan depan", at(30.0)),
        ]);
        let ids: Vec<&str> = schedule.reminders.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["near"]);
    }

    #[test]
    fn a_time_already_past_is_not_sent_as_an_alarm() {
        // An alarm set for yesterday either fires the moment it is armed or not
        // at all, and neither is what anyone wanted.
        let schedule = build_default(&[reminder("stale", "Kemarin", at(-2.0))]);
        assert!(schedule.reminders.is_empty());
    }

    #[test]
    fn finished_and_abandoned_reminders_are_not_sent() {
        let mut done = reminder("done", "Sudah", at(1.0));
        done.status = "done".to_string();
        let mut cancelled = reminder("cancelled", "Batal", at(1.0));
        cancelled.status = "cancelled".to_string();
        let mut missed = reminder("missed", "Terlewat", at(1.0));
        missed.status = "missed".to_string();

        let schedule = build_default(&[done, cancelled, missed]);
        assert!(schedule.reminders.is_empty());
    }

    #[test]
    fn a_snoozed_reminder_fires_at_its_snooze_time_not_its_original_one() {
        // Otherwise snoozing on the desktop would leave the phone ringing at the
        // time the user just pushed away, which reads as the snooze not working.
        let mut snoozed = reminder("s", "Nanti saja", at(0.5));
        snoozed.status = "snoozed".to_string();
        snoozed.snoozed_until = Some(at(2.0));

        let schedule = build_default(&[snoozed]);
        assert_eq!(schedule.reminders[0].fire_at_ms, Some(NOW + 2 * MS_PER_DAY));
    }

    #[test]
    fn a_snoozed_reminder_with_no_snooze_time_is_skipped_rather_than_guessed() {
        let mut broken = reminder("s", "Rusak", at(1.0));
        broken.status = "snoozed".to_string();
        broken.snoozed_until = None;
        assert!(build_default(&[broken]).reminders.is_empty());
    }

    #[test]
    fn an_unparseable_time_is_skipped_rather_than_becoming_a_wrong_alarm() {
        // A wrong alarm is worse than a missing one: it is indistinguishable
        // from the app working correctly.
        let broken = reminder("bad", "Rusak", "not a timestamp".to_string());
        assert!(build_default(&[broken]).reminders.is_empty());
    }

    #[test]
    fn a_chain_is_sent_whole_even_when_a_step_is_already_done() {
        // A chain view with a hole in it reads as data loss rather than as
        // progress, so finished siblings travel with no fire time of their own.
        let mut prep = reminder("prep", "Siapkan bahan", at(-1.0));
        prep.status = "done".to_string();
        prep.next_id = Some("main".to_string());

        let mut main = reminder("main", "Presentasi", at(1.0));
        main.previous_id = Some("prep".to_string());

        let schedule = build_default(&[prep, main]);
        assert_eq!(schedule.reminders.len(), 2);

        let prep_view = schedule.reminders.iter().find(|r| r.id == "prep").unwrap();
        let main_view = schedule.reminders.iter().find(|r| r.id == "main").unwrap();
        assert_eq!(prep_view.fire_at_ms, None, "a done step must not ring");
        assert_eq!(main_view.fire_at_ms, Some(NOW + MS_PER_DAY));
        // Both name the same chain, so the phone can group them.
        assert_eq!(prep_view.chain_id, main_view.chain_id);
        assert!(prep_view.chain_id.is_some());
    }

    #[test]
    fn a_chain_with_nothing_to_fire_is_not_sent_at_all() {
        // Chains ride along with a firing member; they are not a reason of their
        // own to put titles on the network.
        let mut prep = reminder("prep", "Siapkan", at(-2.0));
        prep.status = "done".to_string();
        prep.next_id = Some("main".to_string());
        let mut main = reminder("main", "Selesai juga", at(-1.0));
        main.status = "done".to_string();
        main.previous_id = Some("prep".to_string());

        assert!(build_default(&[prep, main]).reminders.is_empty());
    }

    #[test]
    fn a_standalone_reminder_has_no_chain() {
        let schedule = build_default(&[reminder("solo", "Sendiri", at(1.0))]);
        assert_eq!(schedule.reminders[0].chain_id, None);
    }

    #[test]
    fn tags_travel_because_the_chain_view_shows_them() {
        let mut tagged = reminder("t", "Bimbingan", at(1.0));
        tagged.tags = vec!["skripsi".to_string(), "kampus".to_string()];
        let schedule = build_default(&[tagged]);
        assert_eq!(schedule.reminders[0].tags, vec!["skripsi", "kampus"]);
    }

    #[test]
    fn a_repeat_rule_is_sent_to_display_and_never_expanded() {
        // One entry, not fourteen. The desktop does not compute future
        // occurrences either -- the parser does, on the frontend, when a
        // reminder fires. See the module docs.
        let mut daily = reminder("d", "Minum air", at(0.5));
        daily.recurrence = Some(Recurrence {
            freq: "daily".to_string(),
            interval: 1,
            weekday: None,
            count: None,
        });

        let schedule = build_default(&[daily]);
        assert_eq!(schedule.reminders.len(), 1);
        assert_eq!(
            schedule.reminders[0]
                .recurrence
                .as_ref()
                .map(|r| r.freq.as_str()),
            Some("daily")
        );
    }

    #[test]
    fn the_soonest_alarm_comes_first_and_unscheduled_entries_come_last() {
        let mut prep = reminder("prep", "Siapkan", at(-1.0));
        prep.status = "done".to_string();
        prep.next_id = Some("late".to_string());
        let mut late = reminder("late", "Nanti", at(5.0));
        late.previous_id = Some("prep".to_string());
        let soon = reminder("soon", "Segera", at(0.1));

        let schedule = build_default(&[prep, late, soon]);
        let ids: Vec<&str> = schedule.reminders.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["soon", "late", "prep"]);
    }

    #[test]
    fn an_empty_database_still_produces_a_valid_answer() {
        // The phone must be able to tell "nothing scheduled" from "the request
        // failed", so this is an empty list rather than an error or a 404.
        let schedule = build(&[], NOW, HORIZON_DAYS, vec![], 1);
        assert!(schedule.reminders.is_empty());
        assert_eq!(schedule.generated_at_ms, NOW);
        let json = serde_json::to_string(&schedule).expect("serializes");
        assert!(json.contains("\"reminders\":[]"), "got: {json}");
    }
}
