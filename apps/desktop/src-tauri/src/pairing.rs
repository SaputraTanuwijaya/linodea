//! Pairing: how a phone earns the right to ask this desktop for anything.
//!
//! The model is the one phones already teach people — the desktop shows a short
//! code, you type it on the phone, and from then on the phone holds a long
//! token it sends with every request. The code is the thing a human moves
//! between two screens, so it is short, unambiguous and short-lived; the token
//! is the thing software keeps, so it is long and never displayed again.
//!
//! ## Why a code and not a QR yet
//!
//! A QR is nicer to use, but nothing can scan one until the Kotlin app exists —
//! and the phone's browser is the only test client we have in the meantime.
//! A typed code works in both worlds, so it comes first.
//!
//! ## What is stored, and what isn't
//!
//! Only a *hash* of each device's token is kept. A leaked devices file then
//! reveals which phones are paired but does not let anyone impersonate one,
//! which is the same reason passwords are not stored in the clear.
//!
//! Pairing records live in their own JSON file beside the database rather than
//! in a new SQLite table: they are not reminder data, and a schema migration on
//! the store that holds real users' reminders is a risk this does not need to
//! take. The file is also plain enough to read when something looks wrong.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Characters a person can read off a screen and retype without guessing.
/// No `O`/`0`, no `I`/`L`/`1` — those are the pairs that get mistyped.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

pub const CODE_LENGTH: usize = 6;
/// Long enough to walk to the other device, short enough that a code left on
/// screen doesn't stay useful.
pub const CODE_TTL: Duration = Duration::from_secs(5 * 60);
/// A 6-character code from a 31-character alphabet is ~900 million
/// combinations, which is plenty against a human but not against a script on
/// the same network. Capping attempts is what actually closes that gap — the
/// same reason a phone PIN is four digits and still safe.
pub const MAX_ATTEMPTS: u8 = 10;

/// Bytes of entropy in a device token. 32 bytes is well past anything
/// guessable; it is rendered as 64 hex characters.
const TOKEN_BYTES: usize = 32;

/// The filename used beside the database.
pub const DEVICES_FILE: &str = "paired_devices.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: String,
    /// What the phone called itself. Shown in Settings so a person can tell
    /// which device to revoke; sanitised on the way in, never trusted.
    pub name: String,
    pub token_hash: String,
    pub paired_at_ms: i64,
    pub last_seen_ms: Option<i64>,
}

/// A code currently being offered, and how many wrong guesses it has taken.
#[derive(Debug, Clone)]
pub struct PendingCode {
    pub code: String,
    pub issued_ms: i64,
    pub attempts: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeCheck {
    Accepted,
    Wrong,
    Expired,
    TooManyAttempts,
}

impl PendingCode {
    pub fn new(code: String, now_ms: i64) -> Self {
        Self {
            code,
            issued_ms: now_ms,
            attempts: 0,
        }
    }

    pub fn is_expired(&self, now_ms: i64) -> bool {
        now_ms.saturating_sub(self.issued_ms) > CODE_TTL.as_millis() as i64
    }

    /// Check a candidate, counting the attempt. Expiry and the attempt cap are
    /// checked before the comparison so a burned code can't be probed further.
    pub fn check(&mut self, candidate: &str, now_ms: i64) -> CodeCheck {
        if self.is_expired(now_ms) {
            return CodeCheck::Expired;
        }
        if self.attempts >= MAX_ATTEMPTS {
            return CodeCheck::TooManyAttempts;
        }
        self.attempts += 1;
        if constant_time_eq(
            candidate.trim().to_ascii_uppercase().as_bytes(),
            self.code.as_bytes(),
        ) {
            CodeCheck::Accepted
        } else {
            CodeCheck::Wrong
        }
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn generate_code() -> String {
    let mut rng = rand::rng();
    (0..CODE_LENGTH)
        .map(|_| CODE_ALPHABET[rng.random_range(0..CODE_ALPHABET.len())] as char)
        .collect()
}

pub fn generate_token() -> String {
    let mut rng = rand::rng();
    let bytes: [u8; TOKEN_BYTES] = std::array::from_fn(|_| rng.random());
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Device names arrive from the network, so they are clamped before being
/// stored or shown: control characters stripped, length bounded, and an empty
/// result replaced rather than rendering as a blank row in Settings.
pub fn sanitize_device_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        "Unnamed device".to_string()
    } else {
        cleaned
    }
}

/// Index of the device holding `token`, if any.
///
/// Compares hashes rather than tokens, so a timing leak here would reveal
/// something about a hash and not about the secret. Constant-time anyway: it
/// costs nothing and means one less thing to reason about later.
pub fn find_by_token(devices: &[PairedDevice], token: &str) -> Option<usize> {
    let candidate = hash_token(token);
    devices
        .iter()
        .position(|device| constant_time_eq(candidate.as_bytes(), device.token_hash.as_bytes()))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn devices_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DEVICES_FILE)
}

/// Read the paired devices. A missing or unreadable file means "nothing paired"
/// rather than an error: the failure mode should be a phone that has to pair
/// again, never a desktop that won't start.
pub fn load_devices(path: &Path) -> Vec<PairedDevice> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_devices(path: &Path, devices: &[PairedDevice]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(devices).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
}

/// Build a device record for a freshly accepted pairing, returning it alongside
/// the plaintext token — the only moment the token exists in the clear.
pub fn enroll(name: &str, now_ms: i64) -> (PairedDevice, String) {
    let token = generate_token();
    let device = PairedDevice {
        id: format!("dev_{}", &generate_token()[..12]),
        name: sanitize_device_name(name),
        token_hash: hash_token(&token),
        paired_at_ms: now_ms,
        last_seen_ms: None,
    };
    (device, token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        dir.push(format!("linodea-pairing-test-{name}-{}", generate_token()));
        dir.join(DEVICES_FILE)
    }

    #[test]
    fn codes_avoid_characters_people_mistype() {
        // Someone reads this off a screen and types it on a phone; O/0 and
        // I/L/1 are where that goes wrong.
        for _ in 0..200 {
            let code = generate_code();
            assert_eq!(code.len(), CODE_LENGTH);
            for ch in code.chars() {
                assert!(!"OIL01".contains(ch), "ambiguous character in {code}");
                assert!(ch.is_ascii_uppercase() || ch.is_ascii_digit());
            }
        }
    }

    #[test]
    fn tokens_are_long_and_distinct() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), TOKEN_BYTES * 2);
        assert_ne!(a, b, "tokens must not repeat");
    }

    #[test]
    fn the_stored_record_never_contains_the_token() {
        // The whole point of hashing: a leaked devices file must not let anyone
        // impersonate a paired phone.
        let (device, token) = enroll("Infinix NOTE 40 Pro", 1_700_000_000_000);
        assert_ne!(device.token_hash, token);
        assert!(!device.token_hash.contains(&token));
        assert_eq!(device.token_hash, hash_token(&token));
    }

    #[test]
    fn a_token_identifies_its_own_device_and_no_other() {
        let (first, first_token) = enroll("Phone A", 1);
        let (second, second_token) = enroll("Phone B", 2);
        let devices = vec![first, second];

        assert_eq!(find_by_token(&devices, &first_token), Some(0));
        assert_eq!(find_by_token(&devices, &second_token), Some(1));
        assert_eq!(find_by_token(&devices, "not-a-real-token"), None);
        assert_eq!(find_by_token(&devices, ""), None);
    }

    #[test]
    fn a_correct_code_is_accepted_case_and_space_insensitively() {
        // It is being typed on a phone keyboard, probably with autocapitalise
        // fighting back.
        let mut pending = PendingCode::new("ABC234".into(), 0);
        assert_eq!(pending.check(" abc234 ", 1_000), CodeCheck::Accepted);
    }

    #[test]
    fn a_wrong_code_is_refused_and_counts_against_the_cap() {
        let mut pending = PendingCode::new("ABC234".into(), 0);
        for _ in 0..MAX_ATTEMPTS {
            assert_eq!(pending.check("ZZZZZZ", 1_000), CodeCheck::Wrong);
        }
        // Past the cap the code is burned, so a script on the same network
        // cannot walk the keyspace even though the code itself is short.
        assert_eq!(pending.check("ZZZZZZ", 1_000), CodeCheck::TooManyAttempts);
        assert_eq!(
            pending.check("ABC234", 1_000),
            CodeCheck::TooManyAttempts,
            "a burned code must stay burned even for the right answer"
        );
    }

    #[test]
    fn an_expired_code_is_refused_before_it_is_compared() {
        let mut pending = PendingCode::new("ABC234".into(), 0);
        let past_ttl = CODE_TTL.as_millis() as i64 + 1;
        assert_eq!(pending.check("ABC234", past_ttl), CodeCheck::Expired);
        assert_eq!(
            pending.attempts, 0,
            "an expired code should not consume attempts"
        );
    }

    #[test]
    fn device_names_from_the_network_are_clamped() {
        assert_eq!(sanitize_device_name("  Infinix  "), "Infinix");
        assert_eq!(sanitize_device_name(""), "Unnamed device");
        assert_eq!(sanitize_device_name("   "), "Unnamed device");
        assert_eq!(sanitize_device_name("bad\u{0}name\n"), "badname");
        assert_eq!(sanitize_device_name(&"x".repeat(500)).len(), 64);
    }

    #[test]
    fn devices_round_trip_through_the_file() {
        let path = temp_path("roundtrip");
        let (device, _) = enroll("Infinix NOTE 40 Pro", 1_700_000_000_000);
        save_devices(&path, std::slice::from_ref(&device)).expect("save should work");

        let loaded = load_devices(&path);
        assert_eq!(loaded, vec![device]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_missing_or_corrupt_file_reads_as_nothing_paired() {
        // The failure mode must be "pair again", never "the app won't start".
        assert!(load_devices(Path::new("does-not-exist.json")).is_empty());

        let path = temp_path("corrupt");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"{ not json at all").unwrap();
        assert!(load_devices(&path).is_empty());

        let _ = std::fs::remove_file(&path);
    }
}
