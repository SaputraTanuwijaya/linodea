//! Letting a phone find this machine again after its address changes.
//!
//! Pairing bakes in one IP: the QR encodes `http://192.168.1.155:7643/pair`,
//! and that is what the phone remembers. A router hands out a different lease a
//! week later and the address is simply wrong, with no symptom on the desktop
//! and nothing on the phone but a connection that hangs. For the browser view
//! it is worse — `localStorage` is scoped per origin, and a new IP *is* a new
//! origin, so the stored token disappears along with the address.
//!
//! So the desktop advertises itself over mDNS while its server is running, and
//! the phone looks up the service rather than remembering a number. Android has
//! `NsdManager` for exactly this.
//!
//! ## Why this does not reach past the network
//!
//! mDNS is multicast to `224.0.0.251` with a TTL of 1: it reaches the local
//! link and nothing beyond it. No registry, no broker, nothing to sign up for.
//! That is the same boundary the rest of the link already respects.
//!
//! ## What it does disclose, and the one deliberate omission
//!
//! An advertisement is *unprompted*, which `/health` is not — anyone on the
//! network learns this machine runs Linodea without asking it anything. That is
//! why advertising starts and stops with the server rather than with the app:
//! someone who never enables phone link never announces anything.
//!
//! The instance name is the constant `"Linodea"` and **not** the computer's
//! hostname, even though a hostname would tell two desktops apart. Hostnames on
//! personal machines are very often a person's actual name, and broadcasting
//! that to a cafe network to solve a problem nobody has yet is the wrong trade.
//! If distinguishing two desktops ever matters, it should be a name the user
//! chooses, not one Windows chose for them.

use std::collections::HashMap;

/// The service a phone browses for.
///
/// `_linodea._tcp` is not an IANA-registered service type. That is normal for
/// an application-specific service and is what the underscore-prefixed
/// convention is for; the name only has to be unique in practice.
pub const SERVICE_TYPE: &str = "_linodea._tcp.local.";

/// Shown to whoever is browsing. Deliberately not the hostname — see the module
/// docs.
pub const INSTANCE_NAME: &str = "Linodea";

/// What a phone can read before it opens a connection.
///
/// The protocol version is here rather than only on `/health` so a phone can
/// skip a desktop it cannot talk to without a round trip — the two apps are
/// installed and updated separately, so version mismatches are the normal case
/// and not an error.
pub fn txt_properties(app_version: &str, protocol: u32) -> HashMap<String, String> {
    HashMap::from([
        ("protocol".to_string(), protocol.to_string()),
        ("version".to_string(), app_version.to_string()),
        // Where to go once found. Spelled out so the phone is not hardcoding a
        // path that the desktop might later move.
        ("path".to_string(), "/schedule".to_string()),
    ])
}

/// The advertisement itself.
///
/// Split from registering it so the shape can be asserted in tests without a
/// daemon touching a real network — `cargo test` running in parallel would
/// otherwise spray registrations across whatever network the machine is on.
pub fn service_info(
    port: u16,
    app_version: &str,
    protocol: u32,
) -> Result<mdns_sd::ServiceInfo, String> {
    mdns_sd::ServiceInfo::new(
        SERVICE_TYPE,
        INSTANCE_NAME,
        // The responder fills in a hostname for us; `enable_addr_auto` then
        // keeps the advertised addresses in step with the machine's real ones,
        // which is the whole point -- an advertisement pinned to the address we
        // had at startup would go stale exactly like the QR code does.
        &format!("{INSTANCE_NAME}.local."),
        "",
        port,
        Some(txt_properties(app_version, protocol)),
    )
    .map(|info| info.enable_addr_auto())
    .map_err(|error| format!("could not build mDNS advertisement: {error}"))
}

/// Owns the responder for as long as the server is up.
///
/// Every operation is best-effort. A machine with mDNS blocked by policy, or a
/// network that drops multicast, must still get a working link over a typed
/// address — discovery is a convenience on top of the server, never a
/// precondition for it.
pub struct Advertiser {
    daemon: mdns_sd::ServiceDaemon,
    registered: Option<String>,
}

impl Advertiser {
    pub fn start(port: u16, app_version: &str, protocol: u32) -> Result<Self, String> {
        let daemon = mdns_sd::ServiceDaemon::new()
            .map_err(|error| format!("could not start mDNS responder: {error}"))?;
        let info = service_info(port, app_version, protocol)?;
        let fullname = info.get_fullname().to_string();
        daemon
            .register(info)
            .map_err(|error| format!("could not advertise on the local network: {error}"))?;
        Ok(Self {
            daemon,
            registered: Some(fullname),
        })
    }
}

impl Drop for Advertiser {
    /// Unregister on the way out so browsers see the service disappear rather
    /// than time out against a machine that stopped listening. Tied to `Drop`
    /// because the server can also stop by the app exiting, and a goodbye that
    /// only happened on the tidy path would be the one that never ran.
    fn drop(&mut self) {
        if let Some(fullname) = self.registered.take() {
            let _ = self.daemon.unregister(&fullname);
        }
        let _ = self.daemon.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_service_type_is_the_one_the_phone_will_browse_for() {
        // Pinned because it is half of a contract whose other half lives in a
        // separate repository, on a separately-installed app. A silent rename
        // here would look, from the phone, exactly like the desktop being off.
        assert_eq!(SERVICE_TYPE, "_linodea._tcp.local.");
        assert!(SERVICE_TYPE.ends_with("._tcp.local."));
    }

    #[test]
    fn the_advertisement_never_carries_the_computers_name() {
        // Hostnames on personal machines are very often a person's real name,
        // and an advertisement is unprompted -- it reaches a cafe network
        // whether or not anyone asked. See the module docs.
        let info = service_info(7643, "0.1.5", 1).expect("builds");
        assert_eq!(INSTANCE_NAME, "Linodea");
        assert!(info.get_fullname().starts_with("Linodea."));

        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_default();
        if !hostname.is_empty() {
            let advertised = format!(
                "{} {} {:?}",
                info.get_fullname(),
                info.get_hostname(),
                info.get_properties()
            );
            assert!(
                !advertised.to_lowercase().contains(&hostname.to_lowercase()),
                "the machine's hostname reached the advertisement: {advertised}"
            );
        }
    }

    #[test]
    fn a_phone_can_read_the_protocol_version_before_connecting() {
        // Saves a round trip against a desktop it cannot talk to. The two apps
        // update separately, so a mismatch is ordinary rather than exceptional.
        let props = txt_properties("0.1.5", 1);
        assert_eq!(props.get("protocol").map(String::as_str), Some("1"));
        assert_eq!(props.get("version").map(String::as_str), Some("0.1.5"));
        assert_eq!(props.get("path").map(String::as_str), Some("/schedule"));
    }

    #[test]
    fn the_advertised_port_is_the_one_actually_bound() {
        // The server falls back through four candidate ports, so advertising a
        // hardcoded 7643 would send the phone to a closed socket on exactly the
        // machines where the fallback mattered.
        let info = service_info(7645, "0.1.5", 1).expect("builds");
        assert_eq!(info.get_port(), 7645);
    }

    /// The only test here that touches a real network, so it is opt-in:
    /// `cargo test -- --ignored`. Everything above asserts the *shape* of the
    /// advertisement; this asserts that a browser on this machine can actually
    /// find it, which is the part no amount of struct-checking proves.
    #[test]
    #[ignore]
    fn a_browser_on_this_machine_can_resolve_the_advertisement() {
        use std::time::{Duration, Instant};

        let _advertiser = Advertiser::start(7643, "0.1.5-test", 1).expect("advertises");

        let browser = mdns_sd::ServiceDaemon::new().expect("browser daemon");
        let receiver = browser.browse(SERVICE_TYPE).expect("browse starts");

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut resolved = None;
        while Instant::now() < deadline {
            let left = deadline.saturating_duration_since(Instant::now());
            match receiver.recv_timeout(left) {
                Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                    resolved = Some(info);
                    break;
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }

        let info = resolved.expect("the advertisement should resolve on this machine");
        assert_eq!(info.get_port(), 7643);
        assert!(info.get_fullname().starts_with("Linodea."));
        assert_eq!(
            info.get_property_val_str("protocol").as_deref(),
            Some("1"),
            "a phone reads the protocol before connecting"
        );
        assert!(
            !info.get_addresses().is_empty(),
            "an advertisement with no address is one a phone cannot use"
        );

        let _ = browser.shutdown();
    }
}
