//! Local-network link: the desktop half of phone delivery.
//!
//! The phone companion (v0.2.x) needs a reminder's schedule handed to it once,
//! at capture time; after that the phone's own alarm fires it and the network
//! stops mattering. The desktop is the natural server for that handoff — it is
//! already always-on in the tray, it is a PC, and it can hold a socket all day.
//! The phone *pulls*, because Android kills background listeners (Doze and the
//! OEM battery managers exist to do exactly that), so a phone that listens is a
//! phone that silently stops working.
//!
//! Explicitly NOT over USB. The link exists so a phone that is merely *near* —
//! same Wi-Fi, or tethered to the laptop — can be reached. A cable is a
//! development convenience, never the transport.
//!
//! ## Off by default, on purpose
//!
//! Binding a socket that accepts connections from the whole local network is
//! not something to do to someone without asking. It also triggers a Windows
//! Firewall prompt the first time. Users who never pair a phone should never
//! see either, so the server starts only when the setting is switched on.
//!
//! ## Scope of this slice
//!
//! Reachability only: one unauthenticated `/health` endpoint that proves a
//! phone can talk to this machine, and the addresses to try. It deliberately
//! serves no reminder data yet — pairing, a shared key and the schedule
//! endpoint come next, and shipping an unauthenticated reminder feed in the
//! meantime would be the wrong order to build in.
//!
//! `/health` reveals that this machine runs Linodea, and which version. That is
//! a real if small disclosure to anyone on the same network, which is part of
//! why this is opt-in rather than always-on.

use std::io::Cursor;
use std::net::{IpAddr, TcpListener};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;

/// Preferred port. Fixed rather than ephemeral so the address stays stable
/// across restarts — a phone that remembers where to look shouldn't be wrong
/// every time the app restarts, and it makes the address typeable during
/// testing.
const PREFERRED_PORT: u16 = 7643;
/// Fallbacks if the preferred port is taken by something else.
const FALLBACK_PORTS: [u16; 3] = [7644, 7645, 7646];

/// Version of the desktop↔phone contract. The two apps are installed and
/// updated separately, so they will run at different versions on real machines;
/// the phone checks this before trusting anything else it reads.
pub const PROTOCOL_VERSION: u32 = 1;

/// What the Settings panel renders. Addresses are the LAN IPv4s a phone could
/// actually reach — loopback is useless to another device, so it is filtered
/// out rather than shown and wondered about.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub running: bool,
    pub port: u16,
    pub addresses: Vec<String>,
    pub protocol_version: u32,
}

#[derive(Default)]
struct Running {
    server: Option<Arc<tiny_http::Server>>,
    worker: Option<JoinHandle<()>>,
    port: u16,
}

/// Owns the server's lifetime. Held in Tauri's managed state so the socket
/// lives as long as the app rather than as long as a window.
#[derive(Default)]
pub struct LanService {
    inner: Mutex<Running>,
}

impl LanService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> LanStatus {
        let inner = self.inner.lock().expect("lan state poisoned");
        LanStatus {
            running: inner.server.is_some(),
            port: inner.port,
            addresses: local_addresses(),
            protocol_version: PROTOCOL_VERSION,
        }
    }

    /// Idempotent: starting an already-running server just reports where it is,
    /// so a UI that re-asserts its state on mount can't accidentally spawn two.
    pub fn start(&self, app_version: String) -> Result<LanStatus, String> {
        let mut inner = self.inner.lock().expect("lan state poisoned");
        if inner.server.is_some() {
            return Ok(LanStatus {
                running: true,
                port: inner.port,
                addresses: local_addresses(),
                protocol_version: PROTOCOL_VERSION,
            });
        }

        let (listener, port) = bind_listener()?;
        let server = tiny_http::Server::from_listener(listener, None)
            .map_err(|error| format!("could not start local server: {error}"))?;
        let server = Arc::new(server);

        // Blocking accept loop on its own thread. Traffic here is a handful of
        // requests an hour at most, so a thread is cheaper in complexity than
        // pulling the whole async stack into this module.
        let worker_server = Arc::clone(&server);
        let worker = std::thread::Builder::new()
            .name("linodea-lan".into())
            .spawn(move || serve(worker_server, app_version))
            .map_err(|error| format!("could not spawn server thread: {error}"))?;

        inner.server = Some(server);
        inner.worker = Some(worker);
        inner.port = port;

        Ok(LanStatus {
            running: true,
            port,
            addresses: local_addresses(),
            protocol_version: PROTOCOL_VERSION,
        })
    }

    pub fn stop(&self) -> LanStatus {
        let mut inner = self.inner.lock().expect("lan state poisoned");
        if let Some(server) = inner.server.take() {
            // Releases the thread parked in `recv()`; without it the join below
            // would wait for a request that may never come.
            server.unblock();
        }
        if let Some(worker) = inner.worker.take() {
            let _ = worker.join();
        }
        inner.port = 0;

        LanStatus {
            running: false,
            port: 0,
            addresses: local_addresses(),
            protocol_version: PROTOCOL_VERSION,
        }
    }
}

/// Bind the preferred port, falling back if something else already holds it.
/// Binding 0.0.0.0 is what makes the server reachable from another device; on
/// 127.0.0.1 it would only ever answer this machine.
fn bind_listener() -> Result<(TcpListener, u16), String> {
    let mut last_error = String::new();
    for port in std::iter::once(PREFERRED_PORT).chain(FALLBACK_PORTS) {
        match TcpListener::bind(("0.0.0.0", port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!(
        "no free port in {PREFERRED_PORT}..={} ({last_error})",
        FALLBACK_PORTS[FALLBACK_PORTS.len() - 1]
    ))
}

fn serve(server: Arc<tiny_http::Server>, app_version: String) {
    for request in server.incoming_requests() {
        let response = match request.url().split('?').next().unwrap_or("") {
            "/health" => json_response(200, &health_body(&app_version)),
            _ => json_response(404, "{\"error\":\"not found\"}"),
        };
        let _ = request.respond(response);
    }
}

fn health_body(app_version: &str) -> String {
    format!(
        "{{\"app\":\"linodea\",\"version\":\"{app_version}\",\"protocol\":{PROTOCOL_VERSION},\"paired\":false}}"
    )
}

fn json_response(status: u16, body: &str) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header is valid");
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(header)
}

/// LAN-reachable IPv4 addresses, best guess first.
///
/// Loopback is dropped (another device can never reach it) and so is APIPA
/// 169.254.x.x, which means "DHCP failed" rather than a usable address. Virtual
/// adapters are kept but sorted last: VMware and WSL install their own
/// interfaces, and showing one of those first sends the user to an address
/// their phone cannot reach.
fn local_addresses() -> Vec<String> {
    let Ok(interfaces) = if_addrs::get_if_addrs() else {
        return Vec::new();
    };

    let mut addresses: Vec<(bool, String)> = interfaces
        .into_iter()
        .filter_map(|interface| {
            let IpAddr::V4(ip) = interface.ip() else {
                return None;
            };
            if ip.is_loopback() || ip.is_link_local() {
                return None;
            }
            Some((is_probably_virtual(&interface.name), ip.to_string()))
        })
        .collect();

    addresses.sort();
    addresses.dedup();
    addresses.into_iter().map(|(_, ip)| ip).collect()
}

fn is_probably_virtual(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    [
        "vmware",
        "virtualbox",
        "vethernet",
        "wsl",
        "hyper-v",
        "docker",
    ]
    .iter()
    .any(|marker| name.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_body_is_valid_json_carrying_the_protocol_version() {
        let body = health_body("0.1.5");
        let parsed: serde_json::Value =
            serde_json::from_str(&body).expect("health body must parse as JSON");
        assert_eq!(parsed["app"], "linodea");
        assert_eq!(parsed["version"], "0.1.5");
        // The phone reads this before trusting anything else, so a drift here
        // is a silent incompatibility rather than a loud error.
        assert_eq!(parsed["protocol"], PROTOCOL_VERSION);
    }

    #[test]
    fn virtual_adapters_are_recognised_by_name() {
        // Saputra's machine has VMware and WSL adapters alongside the real
        // Wi-Fi; listing one of those first would send him to an address his
        // phone can never reach.
        assert!(is_probably_virtual("VMware Network Adapter VMnet8"));
        assert!(is_probably_virtual("vEthernet (WSL (Hyper-V firewall))"));
        assert!(!is_probably_virtual("Wi-Fi"));
        assert!(!is_probably_virtual("Ethernet"));
    }

    #[test]
    fn real_interfaces_sort_before_virtual_ones() {
        let mut entries = vec![
            (true, "192.168.160.1".to_string()),
            (false, "10.127.16.155".to_string()),
        ];
        entries.sort();
        assert_eq!(entries[0].1, "10.127.16.155");
    }

    #[test]
    fn stopping_a_server_that_never_started_is_harmless() {
        // The UI re-asserts its state on mount, so stop() runs against an idle
        // service routinely; it must not panic or block.
        let service = LanService::new();
        let status = service.stop();
        assert!(!status.running);
        assert_eq!(status.port, 0);
    }

    /// Minimal HTTP client for the round-trip tests below.
    ///
    /// The read is bounded by a timeout rather than waiting for the connection
    /// to close: a test that can hang forever is worse than one that fails, and
    /// this one did hang once, when a malformed request (bare LF instead of
    /// CRLF) left the server waiting for a terminator that never arrived.
    fn fetch(port: u16, path: &str) -> String {
        use std::io::{Read, Write};
        use std::time::Duration;

        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port))
            .expect("server should accept a connection");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("read timeout should be settable");
        let request =
            format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
        stream
            .write_all(request.as_bytes())
            .expect("request should send");

        let mut response = Vec::new();
        let mut chunk = [0u8; 1024];
        while let Ok(read) = stream.read(&mut chunk) {
            if read == 0 {
                break;
            }
            response.extend_from_slice(&chunk[..read]);
        }
        String::from_utf8_lossy(&response).into_owned()
    }

    /// End-to-end over a real socket: bind, connect as a client would, and read
    /// the response. The unit tests above prove the pieces; this proves the
    /// thing a phone actually does.
    #[test]
    fn a_client_can_fetch_health_over_a_real_socket() {
        let service = LanService::new();
        let status = service.start("9.9.9-test".into()).expect("should bind");

        let response = fetch(status.port, "/health");
        service.stop();

        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("application/json"));
        assert!(response.contains("\"version\":\"9.9.9-test\""));
        assert!(response.contains("\"app\":\"linodea\""));
    }

    #[test]
    fn unknown_paths_are_refused_rather_than_served() {
        let service = LanService::new();
        let status = service.start("9.9.9-test".into()).expect("should bind");

        let response = fetch(status.port, "/reminders");
        service.stop();

        // This slice deliberately serves no reminder data. If a future change
        // adds an endpoint, it must arrive with authentication, not by accident.
        assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");
    }

    #[test]
    fn start_is_idempotent_and_stop_releases_the_port() {
        let service = LanService::new();
        let first = service.start("0.0.0-test".into()).expect("should bind");
        assert!(first.running);
        assert!(first.port >= PREFERRED_PORT);

        // A second start must not spawn a second server on a second port.
        let second = service.start("0.0.0-test".into()).expect("already running");
        assert_eq!(second.port, first.port);

        assert!(!service.stop().running);
    }
}
