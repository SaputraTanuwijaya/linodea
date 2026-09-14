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
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde::Serialize;

use crate::pairing::{self, CodeCheck, PairedDevice};

/// Preferred port. Fixed rather than ephemeral so the address stays stable
/// across restarts — a phone that remembers where to look shouldn't be wrong
/// every time the app restarts, and it makes the address typeable during
/// testing.
const PREFERRED_PORT: u16 = 7643;
/// Tried in order; the first free one wins.
const CANDIDATE_PORTS: [u16; 4] = [PREFERRED_PORT, 7644, 7645, 7646];

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

/// What the pairing UI needs to render. The code is present only while an
/// invitation is open; `null` the rest of the time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingState {
    pub code: Option<String>,
    pub expires_at_ms: Option<i64>,
    pub devices: Vec<PairedDevice>,
}

#[derive(Default)]
struct Running {
    server: Option<Arc<tiny_http::Server>>,
    worker: Option<JoinHandle<()>>,
    port: u16,
}

/// State the request handler needs. Separate from `Running` because the worker
/// thread outlives any single request and must not hold the lifecycle lock —
/// taking both would deadlock a stop() that runs while a request is in flight.
struct Shared {
    devices_path: PathBuf,
    app_version: Mutex<String>,
    pending: Mutex<Option<pairing::PendingCode>>,
    devices: Mutex<Vec<PairedDevice>>,
}

/// Owns the server's lifetime. Held in Tauri's managed state so the socket
/// lives as long as the app rather than as long as a window.
pub struct LanService {
    inner: Mutex<Running>,
    shared: Arc<Shared>,
}

impl LanService {
    pub fn new(devices_path: PathBuf) -> Self {
        let devices = pairing::load_devices(&devices_path);
        Self {
            inner: Mutex::new(Running::default()),
            shared: Arc::new(Shared {
                devices_path,
                app_version: Mutex::new(String::new()),
                pending: Mutex::new(None),
                devices: Mutex::new(devices),
            }),
        }
    }

    /// Open a pairing window: generate a code, show it, and accept it until it
    /// expires. Replacing an open invitation is deliberate — the visible code
    /// should always be the one that works.
    pub fn begin_pairing(&self) -> PairingState {
        let code = pairing::generate_code();
        let now = pairing::now_ms();
        *self.shared.pending.lock().expect("pending poisoned") =
            Some(pairing::PendingCode::new(code, now));
        self.pairing_state()
    }

    pub fn cancel_pairing(&self) -> PairingState {
        *self.shared.pending.lock().expect("pending poisoned") = None;
        self.pairing_state()
    }

    pub fn pairing_state(&self) -> PairingState {
        let pending = self.shared.pending.lock().expect("pending poisoned");
        let live = pending
            .as_ref()
            .filter(|code| !code.is_expired(pairing::now_ms()));
        PairingState {
            code: live.map(|c| c.code.clone()),
            expires_at_ms: live.map(|c| c.issued_ms + pairing::CODE_TTL.as_millis() as i64),
            devices: self
                .shared
                .devices
                .lock()
                .expect("devices poisoned")
                .clone(),
        }
    }

    /// Revoke a device. Its token stops working immediately, because every
    /// request is checked against this list rather than against anything the
    /// phone holds.
    pub fn forget_device(&self, id: &str) -> Result<PairingState, String> {
        {
            let mut devices = self.shared.devices.lock().expect("devices poisoned");
            devices.retain(|device| device.id != id);
            pairing::save_devices(&self.shared.devices_path, &devices)?;
        }
        Ok(self.pairing_state())
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
        self.start_on(app_version, &CANDIDATE_PORTS)
    }

    /// Split out so tests can pass `&[0]` and let the OS assign a free port.
    /// With a fixed candidate list the suite exhausts all four as soon as more
    /// than four tests bind a server at once, which `cargo test` does by default.
    fn start_on(&self, app_version: String, candidates: &[u16]) -> Result<LanStatus, String> {
        let mut inner = self.inner.lock().expect("lan state poisoned");
        if inner.server.is_some() {
            return Ok(LanStatus {
                running: true,
                port: inner.port,
                addresses: local_addresses(),
                protocol_version: PROTOCOL_VERSION,
            });
        }

        *self.shared.app_version.lock().expect("version poisoned") = app_version;

        let (listener, port) = bind_listener(candidates)?;
        let server = tiny_http::Server::from_listener(listener, None)
            .map_err(|error| format!("could not start local server: {error}"))?;
        let server = Arc::new(server);

        // Blocking accept loop on its own thread. Traffic here is a handful of
        // requests an hour at most, so a thread is cheaper in complexity than
        // pulling the whole async stack into this module.
        let worker_server = Arc::clone(&server);
        let worker_shared = Arc::clone(&self.shared);
        let worker = std::thread::Builder::new()
            .name("linodea-lan".into())
            .spawn(move || serve(worker_server, worker_shared))
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
fn bind_listener(candidates: &[u16]) -> Result<(TcpListener, u16), String> {
    let mut last_error = String::new();
    for &port in candidates {
        match TcpListener::bind(("0.0.0.0", port)) {
            Ok(listener) => {
                // Port 0 asks the OS to pick, so read back what we actually got
                // rather than reporting the request.
                let bound = listener
                    .local_addr()
                    .map(|addr| addr.port())
                    .unwrap_or(port);
                return Ok((listener, bound));
            }
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(format!("no free port in {candidates:?} ({last_error})"))
}

fn serve(server: Arc<tiny_http::Server>, shared: Arc<Shared>) {
    for mut request in server.incoming_requests() {
        let path = request.url().split('?').next().unwrap_or("").to_string();
        let method = request.method().clone();

        let response = match (&method, path.as_str()) {
            (tiny_http::Method::Get, "/health") => {
                let version = shared.app_version.lock().expect("version poisoned").clone();
                let paired = !shared.devices.lock().expect("devices poisoned").is_empty();
                json_response(200, &health_body(&version, paired))
            }
            // A browser is the only pairing client that exists until the Kotlin
            // app does, so GET serves a form and POST does the work. The Android
            // app will POST the same shape and ignore the HTML entirely.
            (tiny_http::Method::Get, "/pair") => html_response(200, &pair_form_page(None)),
            (tiny_http::Method::Post, "/pair") => handle_pair(&mut request, &shared),
            (tiny_http::Method::Get, "/me") => handle_me(&request, &shared),
            _ => json_response(404, "{\"error\":\"not found\"}"),
        };
        let _ = request.respond(response);
    }
}

fn health_body(app_version: &str, paired: bool) -> String {
    format!(
        "{{\"app\":\"linodea\",\"version\":\"{app_version}\",\"protocol\":{PROTOCOL_VERSION},\"paired\":{paired}}}"
    )
}

/// Exchange a pairing code for a device token.
///
/// Every refusal returns the same shape and says only that the code was not
/// accepted — distinguishing "wrong" from "expired" from "too many tries" would
/// tell someone probing the endpoint which of those they are up against.
/// Settings shows the real reason to the person who can act on it.
fn handle_pair(
    request: &mut tiny_http::Request,
    shared: &Arc<Shared>,
) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let mut body = String::new();
    if std::io::Read::read_to_string(request.as_reader(), &mut body).is_err() {
        return json_response(400, "{\"error\":\"unreadable body\"}");
    }
    let form = parse_form(&body);
    let code = form.get("code").cloned().unwrap_or_default();
    let name = form.get("device").cloned().unwrap_or_default();
    let wants_html = request
        .headers()
        .iter()
        .any(|h| h.field.equiv("Accept") && h.value.as_str().contains("text/html"));

    let outcome = {
        let mut pending = shared.pending.lock().expect("pending poisoned");
        match pending.as_mut() {
            Some(open) => open.check(&code, pairing::now_ms()),
            None => CodeCheck::Wrong,
        }
    };

    if outcome != CodeCheck::Accepted {
        return if wants_html {
            html_response(401, &pair_form_page(Some("That code was not accepted.")))
        } else {
            json_response(401, "{\"error\":\"pairing refused\"}")
        };
    }

    // Single use: consume the invitation so a code that reached one phone
    // cannot be replayed by another.
    *shared.pending.lock().expect("pending poisoned") = None;

    let (device, token) = pairing::enroll(&name, pairing::now_ms());
    {
        let mut devices = shared.devices.lock().expect("devices poisoned");
        devices.push(device.clone());
        if let Err(error) = pairing::save_devices(&shared.devices_path, &devices) {
            return json_response(500, &format!("{{\"error\":\"{}\"}}", escape_json(&error)));
        }
    }

    if wants_html {
        html_response(200, &paired_page(&device.name, &token))
    } else {
        json_response(
            200,
            &format!(
                "{{\"token\":\"{token}\",\"deviceId\":\"{}\",\"protocol\":{PROTOCOL_VERSION}}}",
                device.id
            ),
        )
    }
}

/// Prove a token works. The first authenticated endpoint, and the template for
/// every one that follows: read the bearer token, look it up, refuse otherwise.
fn handle_me(
    request: &tiny_http::Request,
    shared: &Arc<Shared>,
) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let Some(token) = bearer_token(request) else {
        return json_response(401, "{\"error\":\"missing token\"}");
    };
    let mut devices = shared.devices.lock().expect("devices poisoned");
    let Some(index) = pairing::find_by_token(&devices, &token) else {
        return json_response(401, "{\"error\":\"unknown token\"}");
    };

    // Last-seen is what turns "my phone stopped ringing" into something
    // diagnosable from the desktop side.
    devices[index].last_seen_ms = Some(pairing::now_ms());
    let device = devices[index].clone();
    let _ = pairing::save_devices(&shared.devices_path, &devices);
    drop(devices);

    json_response(
        200,
        &format!(
            "{{\"deviceId\":\"{}\",\"name\":\"{}\",\"protocol\":{PROTOCOL_VERSION}}}",
            device.id,
            escape_json(&device.name)
        ),
    )
}

fn bearer_token(request: &tiny_http::Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .and_then(|h| h.value.as_str().strip_prefix("Bearer ").map(str::to_string))
        .filter(|token| !token.is_empty())
}

/// Minimal `application/x-www-form-urlencoded` parser. Hand-rolled because the
/// only fields are a code and a device name; a dependency would be more surface
/// than the problem.
fn parse_form(body: &str) -> std::collections::HashMap<String, String> {
    body.split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| {
            let (key, value) = pair.split_once('=')?;
            Some((percent_decode(key), percent_decode(value)))
        })
        .collect()
}

fn percent_decode(raw: &str) -> String {
    let bytes = raw.replace('+', " ");
    let bytes = bytes.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&raw[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn escape_html(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_json(raw: &str) -> String {
    raw.replace('\\', "\\\\").replace('"', "\\\"")
}

fn json_response(status: u16, body: &str) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let header = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header is valid");
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(header)
}

fn html_response(status: u16, body: &str) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let header =
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..])
            .expect("static header is valid");
    tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(header)
}

/// Styling is inline and deliberately plain: this page exists to be usable on a
/// phone before the real app exists, not to be pretty.
const PAGE_STYLE: &str = "body{margin:0;min-height:100vh;display:grid;place-items:center;\
background:#18181b;color:#f4f4f5;font-family:system-ui,sans-serif;padding:24px}\
main{width:100%;max-width:22rem}h1{font-size:20px;margin:0 0 6px}\
p{color:#a1a1aa;font-size:14px;line-height:1.5;margin:0 0 18px}\
label{display:block;font-size:13px;color:#a1a1aa;margin:0 0 6px}\
input{width:100%;box-sizing:border-box;font-size:18px;padding:12px;margin:0 0 14px;\
border-radius:10px;border:1px solid #3f3f46;background:#27272a;color:#f4f4f5}\
button{width:100%;font-size:16px;font-weight:600;padding:12px;border-radius:10px;\
border:0;background:#e4e4e7;color:#18181b}\
code{display:block;word-break:break-all;background:#27272a;border:1px solid #3f3f46;\
border-radius:10px;padding:12px;font-size:12px;margin:0 0 18px}\
.err{color:#fca5a5;font-size:14px;margin:0 0 14px}";

fn pair_form_page(error: Option<&str>) -> String {
    let error_html = error
        .map(|message| format!("<p class=\"err\">{}</p>", escape_html(message)))
        .unwrap_or_default();
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>Pair with Linodea</title><style>{PAGE_STYLE}</style></head><body><main>\
<h1>Pair with Linodea</h1>\
<p>Open Settings &rarr; Phone link on your computer and start pairing. Type the code it shows.</p>\
{error_html}\
<form method=\"post\" action=\"/pair\">\
<label for=\"code\">Pairing code</label>\
<input id=\"code\" name=\"code\" autocapitalize=\"characters\" autocomplete=\"off\" \
autocorrect=\"off\" spellcheck=\"false\" inputmode=\"text\" maxlength=\"8\" required>\
<label for=\"device\">Device name</label>\
<input id=\"device\" name=\"device\" value=\"My phone\" maxlength=\"64\">\
<button type=\"submit\">Pair</button>\
</form></main></body></html>"
    )
}

fn paired_page(name: &str, token: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>Paired</title><style>{PAGE_STYLE}</style></head><body><main>\
<h1>Paired</h1>\
<p><strong>{}</strong> is now paired with this computer. It will show up in Settings \
&rarr; Phone link, where you can remove it at any time.</p>\
<p>The Linodea app would keep this key for you. It is shown here only because a browser \
has nowhere to store it &mdash; you do not need to write it down.</p>\
<code>{}</code>\
<p>Nothing is scheduled to your phone yet; that comes next.</p>\
</main></body></html>",
        escape_html(name),
        escape_html(token)
    )
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
        let body = health_body("0.1.5", false);
        let parsed: serde_json::Value =
            serde_json::from_str(&body).expect("health body must parse as JSON");
        assert_eq!(parsed["app"], "linodea");
        assert_eq!(parsed["version"], "0.1.5");
        // The phone reads this before trusting anything else, so a drift here
        // is a silent incompatibility rather than a loud error.
        assert_eq!(parsed["protocol"], PROTOCOL_VERSION);
        assert_eq!(parsed["paired"], false);
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
        let (service, _path) = temp_service();
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
        let (service, path) = temp_service();
        let status = service
            .start_on("9.9.9-test".into(), &[0])
            .expect("should bind");

        let response = fetch(status.port, "/health");
        service.stop();
        let _ = std::fs::remove_file(&path);

        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("application/json"));
        assert!(response.contains("\"version\":\"9.9.9-test\""));
        assert!(response.contains("\"app\":\"linodea\""));
    }

    #[test]
    fn unknown_paths_are_refused_rather_than_served() {
        let (service, path) = temp_service();
        let status = service
            .start_on("9.9.9-test".into(), &[0])
            .expect("should bind");

        let response = fetch(status.port, "/reminders");
        service.stop();
        let _ = std::fs::remove_file(&path);

        // This slice deliberately serves no reminder data. If a future change
        // adds an endpoint, it must arrive with authentication, not by accident.
        assert!(response.starts_with("HTTP/1.1 404"), "got: {response}");
    }

    /// Same bounded-read client, but POSTing a form the way the pairing page
    /// (and later the Android app) does.
    fn post_form(port: u16, path: &str, body: &str, accept_html: bool) -> String {
        use std::io::{Read, Write};
        use std::time::Duration;

        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        let accept = if accept_html {
            "text/html"
        } else {
            "application/json"
        };
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: localhost\r\nAccept: {accept}\r\n\
Content-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\
Connection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(request.as_bytes()).expect("send");

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

    fn fetch_with_token(port: u16, path: &str, token: &str) -> String {
        use std::io::{Read, Write};
        use std::time::Duration;

        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("timeout");
        let request = format!(
            "GET {path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\
Connection: close\r\n\r\n"
        );
        stream.write_all(request.as_bytes()).expect("send");

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

    fn temp_service() -> (LanService, PathBuf) {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "linodea-lan-test-{}",
            crate::pairing::generate_token()
        ));
        let path = crate::pairing::devices_path(&dir);
        (LanService::new(path.clone()), path)
    }

    /// The whole pairing round trip the way a phone performs it: ask for a
    /// code, send it, get a token, then use that token on an authenticated
    /// endpoint.
    #[test]
    fn a_phone_can_pair_with_the_shown_code_and_then_authenticate() {
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        let code = service.begin_pairing().code.expect("code is offered");

        let response = post_form(
            status.port,
            "/pair",
            &format!("code={code}&device=Infinix+NOTE+40+Pro"),
            false,
        );
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");

        let token = response
            .rsplit_once("\"token\":\"")
            .and_then(|(_, rest)| rest.split('"').next())
            .expect("token in response")
            .to_string();

        // The token now works, and the device name survived form decoding.
        let me = fetch_with_token(status.port, "/me", &token);
        assert!(me.starts_with("HTTP/1.1 200"), "got: {me}");
        assert!(me.contains("Infinix NOTE 40 Pro"), "got: {me}");

        // ...and the desktop knows about it.
        let state = service.pairing_state();
        assert_eq!(state.devices.len(), 1);
        assert_eq!(state.devices[0].name, "Infinix NOTE 40 Pro");
        // The invitation is single-use, so the code is gone.
        assert!(state.code.is_none(), "code should be consumed by pairing");

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_wrong_code_pairs_nothing() {
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        service.begin_pairing();

        let response = post_form(status.port, "/pair", "code=WRONG1&device=Nope", false);
        assert!(response.starts_with("HTTP/1.1 401"), "got: {response}");
        assert!(service.pairing_state().devices.is_empty());

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pairing_is_refused_when_no_invitation_is_open() {
        // Without this, a code guessed at any time would work forever. Pairing
        // must only be possible while someone is deliberately offering it.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");

        let response = post_form(status.port, "/pair", "code=ABC234&device=Nope", false);
        assert!(response.starts_with("HTTP/1.1 401"), "got: {response}");
        assert!(service.pairing_state().devices.is_empty());

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn authenticated_endpoints_refuse_missing_and_revoked_tokens() {
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        let code = service.begin_pairing().code.expect("code");
        let paired = post_form(
            status.port,
            "/pair",
            &format!("code={code}&device=Phone"),
            false,
        );
        let token = paired
            .rsplit_once("\"token\":\"")
            .and_then(|(_, rest)| rest.split('"').next())
            .expect("token")
            .to_string();

        assert!(fetch(status.port, "/me").starts_with("HTTP/1.1 401"));
        assert!(fetch_with_token(status.port, "/me", "bogus").starts_with("HTTP/1.1 401"));

        // Revoking is what makes "remove device" in Settings mean something:
        // the token dies with the record, not whenever the phone notices.
        let id = service.pairing_state().devices[0].id.clone();
        service.forget_device(&id).expect("forget");
        assert!(
            fetch_with_token(status.port, "/me", &token).starts_with("HTTP/1.1 401"),
            "a revoked token must stop working immediately"
        );

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_browser_gets_a_form_rather_than_json() {
        // The phone's browser is the only pairing client until the Kotlin app
        // exists, so /pair has to be usable by hand.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");

        let response = fetch(status.port, "/pair");
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("text/html"));
        assert!(response.contains("<form"));
        assert!(response.contains("Pairing code"));

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn health_reports_whether_anything_is_paired() {
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        assert!(fetch(status.port, "/health").contains("\"paired\":false"));

        let code = service.begin_pairing().code.expect("code");
        post_form(
            status.port,
            "/pair",
            &format!("code={code}&device=Phone"),
            false,
        );
        assert!(fetch(status.port, "/health").contains("\"paired\":true"));

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn form_values_are_decoded_including_escapes_and_plus_signs() {
        let form = parse_form("code=ABC234&device=Infinix+NOTE%2040+Pro");
        assert_eq!(form.get("code").map(String::as_str), Some("ABC234"));
        assert_eq!(
            form.get("device").map(String::as_str),
            Some("Infinix NOTE 40 Pro")
        );
    }

    #[test]
    fn a_device_name_cannot_inject_markup_into_the_paired_page() {
        // The name arrives from the network and is rendered back into HTML.
        let page = paired_page("<script>alert(1)</script>", "tok");
        assert!(!page.contains("<script>alert"));
        assert!(page.contains("&lt;script&gt;"));
    }

    #[test]
    fn start_is_idempotent_and_stop_releases_the_port() {
        let (service, _path) = temp_service();
        let first = service
            .start_on("0.0.0-test".into(), &[0])
            .expect("should bind");
        assert!(first.running);
        assert!(first.port > 0);

        // A second start must not spawn a second server on a second port.
        let second = service
            .start_on("0.0.0-test".into(), &[0])
            .expect("already running");
        assert_eq!(second.port, first.port);

        assert!(!service.stop().running);
    }
}
