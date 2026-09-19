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

use std::io::{Cursor, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;

use crate::data::ReminderStore;
use crate::discovery::Advertiser;
use crate::pairing::{self, CodeCheck, PairedDevice};
use crate::schedule;

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

/// How long a single address gets to answer before it is called dead.
///
/// A reachable address on the same machine answers in single-digit milliseconds,
/// so this is generous. It is sized for the failure case instead: a configured
/// address on an adapter with no link can hang rather than refuse, and that hang
/// is the whole reason the probe exists.
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);

/// The quiet zone is part of the QR spec, not decoration — scanners use it to
/// find the code's edges, and a QR butted up against a panel border reads
/// unreliably or not at all.
const QUIET_ZONE: u32 = 4;

/// One address and whether it actually answered.
///
/// **`reachable` means "this computer reached it", not "a phone can".** The
/// probe runs from the same machine, so it catches a dead adapter — an address
/// left behind by an unplugged Ethernet cable, a virtual switch with nothing
/// behind it — and cannot catch client isolation or a firewall that allows
/// Private but not Public networks, both of which are invisible from here. So a
/// false here is conclusive and a true is only encouraging, and the panel says
/// so rather than promising more than it knows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddressProbe {
    pub address: String,
    pub reachable: bool,
}

/// A QR code as SVG path data in module units.
///
/// Handed over as a path rather than as markup or a PNG: the frontend drops it
/// into one `<path>` inside its own `<svg>`, which means no image encoding, no
/// `dangerouslySetInnerHTML`, and a code that scales to any size and inverts
/// cleanly between the two themes because the color is the caller's.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrImage {
    /// Side length in modules, quiet zone included — i.e. the SVG viewBox.
    pub size: u32,
    /// `d` attribute for a single `<path>`: one subpath per horizontal run of
    /// dark modules, which keeps a typical pairing code to a few hundred bytes.
    pub path: String,
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
    /// Held only while the server is up, so a machine that never enables phone
    /// link never announces itself. Dropping it sends the mDNS goodbye.
    advertiser: Option<Advertiser>,
}

/// State the request handler needs. Separate from `Running` because the worker
/// thread outlives any single request and must not hold the lifecycle lock —
/// taking both would deadlock a stop() that runs while a request is in flight.
struct Shared {
    devices_path: PathBuf,
    app_version: Mutex<String>,
    pending: Mutex<Option<pairing::PendingCode>>,
    devices: Mutex<Vec<PairedDevice>>,
    /// The same store the UI commands use, so `/schedule` can never answer with
    /// a reminder the desktop has already changed or deleted.
    reminders: Arc<Mutex<ReminderStore>>,
    /// Mirrored from the frontend, which owns this setting in localStorage.
    prealert_offsets: Mutex<Vec<i64>>,
}

/// Owns the server's lifetime. Held in Tauri's managed state so the socket
/// lives as long as the app rather than as long as a window.
pub struct LanService {
    inner: Mutex<Running>,
    shared: Arc<Shared>,
}

impl LanService {
    pub fn new(devices_path: PathBuf, reminders: Arc<Mutex<ReminderStore>>) -> Self {
        let devices = pairing::load_devices(&devices_path);
        Self {
            inner: Mutex::new(Running::default()),
            shared: Arc::new(Shared {
                devices_path,
                app_version: Mutex::new(String::new()),
                pending: Mutex::new(None),
                devices: Mutex::new(devices),
                reminders,
                prealert_offsets: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Mirror the desktop's prealert configuration for `/schedule` to send on.
    pub fn set_prealert_offsets(&self, minutes: Vec<i64>) {
        *self
            .shared
            .prealert_offsets
            .lock()
            .expect("prealerts poisoned") = minutes;
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

    /// Ask every local address whether it actually answers.
    ///
    /// Exists because the address list is a list of *candidates*, not of working
    /// endpoints, and nothing in it says which is which: S87 found an Ethernet
    /// address that times out while Wi-Fi answers, and only string-sort luck put
    /// the working one first. That was survivable while the panel showed a list
    /// a person could try in turn. It stops being survivable once a QR encodes
    /// exactly one of them, because a scan that lands on the dead address just
    /// hangs, with no second thing to try.
    pub fn probe_addresses(&self) -> Vec<AddressProbe> {
        // Read and release before probing: the probe talks to our own server,
        // and holding the lifecycle lock across a network round trip would
        // block any concurrent stop() for the full timeout.
        let (running, port) = {
            let inner = self.inner.lock().expect("lan state poisoned");
            (inner.server.is_some(), inner.port)
        };

        let addresses = local_addresses();
        if !running {
            return addresses
                .into_iter()
                .map(|address| AddressProbe {
                    address,
                    reachable: false,
                })
                .collect();
        }

        // In parallel, because a dead address costs the whole timeout and these
        // are exactly the machines that have several: probing four in sequence
        // would freeze the panel for six seconds to learn what takes one and a
        // half.
        let handles: Vec<_> = addresses
            .into_iter()
            .map(|address| {
                std::thread::spawn(move || {
                    let reachable = probe_one(&address, port, PROBE_TIMEOUT);
                    AddressProbe { address, reachable }
                })
            })
            .collect();

        handles
            .into_iter()
            .filter_map(|handle| handle.join().ok())
            .collect()
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

        let app_version_for_mdns = app_version.clone();
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

        // Best-effort, and deliberately after the socket is up: discovery is a
        // convenience on top of a working server, never a precondition for one.
        // A network that drops multicast, or a policy that blocks mDNS, must
        // still leave a link that works from a typed address.
        inner.advertiser = advertise(port, &app_version_for_mdns);

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
        // Drop order matters only for tidiness here, but the goodbye should go
        // out once the socket is genuinely closed rather than before.
        inner.advertiser = None;
        inner.port = 0;

        LanStatus {
            running: false,
            port: 0,
            addresses: local_addresses(),
            protocol_version: PROTOCOL_VERSION,
        }
    }
}

/// Start advertising, or don't, without ever failing the server.
///
/// Silent under `cargo test`: the suite runs many servers in parallel, and a
/// test run should not spray mDNS registrations across whatever network the
/// developer's machine happens to be on. The shape of the advertisement is
/// asserted directly in `discovery`'s own tests instead.
fn advertise(port: u16, app_version: &str) -> Option<Advertiser> {
    if cfg!(test) {
        return None;
    }
    match Advertiser::start(port, app_version, PROTOCOL_VERSION) {
        Ok(advertiser) => Some(advertiser),
        Err(error) => {
            // Worth saying out loud -- a phone that cannot find this machine
            // has no symptom of its own, so the only clue lives here.
            eprintln!("linodea: local-network discovery unavailable: {error}");
            None
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

/// One address, one verdict.
///
/// A full `GET /health` rather than a bare TCP connect: connecting proves only
/// that something accepted, which on a machine with several adapters is not the
/// same as proving our own server is what answered. Reading the status line
/// costs one more round trip on an address that was going to work anyway.
fn probe_one(address: &str, port: u16, timeout: Duration) -> bool {
    let Ok(ip) = address.parse::<IpAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&SocketAddr::new(ip, port), timeout) else {
        return false;
    };
    // Both directions need a deadline. A connect can succeed against a half-open
    // path that then never sends a byte, and without a read timeout that parks
    // the probe thread forever.
    if stream.set_write_timeout(Some(timeout)).is_err()
        || stream.set_read_timeout(Some(timeout)).is_err()
    {
        return false;
    }

    let request =
        format!("GET /health HTTP/1.1\r\nHost: {address}:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    // Exactly the length of "HTTP/1.1 200 OK" -- enough to tell our own 200 from
    // a refusal or from whatever else might be squatting on the port.
    let mut head = [0u8; 15];
    if stream.read_exact(&mut head).is_err() {
        return false;
    }
    head.starts_with(b"HTTP/1.1 200")
}

/// Encode `text` as QR modules and flatten them into SVG path data.
///
/// Runs of dark modules are merged along each row, so the path carries one
/// subpath per run instead of one per module — a version-3 code drops from
/// ~450 rectangles to a few dozen, which matters because this string crosses
/// the IPC boundary every time the pairing panel re-renders.
pub fn qr_image(text: &str) -> Result<QrImage, String> {
    let code = qrcode::QrCode::new(text.as_bytes())
        .map_err(|error| format!("could not encode QR: {error}"))?;
    let width = code.width();
    let modules = code.to_colors();

    let mut path = String::new();
    for y in 0..width {
        let mut x = 0;
        while x < width {
            if modules[y * width + x] != qrcode::Color::Dark {
                x += 1;
                continue;
            }
            let start = x;
            while x < width && modules[y * width + x] == qrcode::Color::Dark {
                x += 1;
            }
            let run = x - start;
            path.push_str(&format!(
                "M{} {}h{run}v1h-{run}z",
                start as u32 + QUIET_ZONE,
                y as u32 + QUIET_ZONE
            ));
        }
    }

    Ok(QrImage {
        size: width as u32 + QUIET_ZONE * 2,
        path,
    })
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
            (tiny_http::Method::Get, "/pair") => {
                // `?code=` is what the pairing QR carries, so a scan lands on a
                // form with the code already in it and the phone's owner only
                // has to name the device.
                let prefill = query_param(request.url(), "code");
                html_response(200, &pair_form_page(None, prefill.as_deref()))
            }
            (tiny_http::Method::Post, "/pair") => handle_pair(&mut request, &shared),
            (tiny_http::Method::Get, "/me") => handle_me(&request, &shared),
            (tiny_http::Method::Get, "/schedule") => handle_schedule(&request, &shared),
            // The phone's own view. Serves no reminder data itself -- the page
            // fetches `/schedule` with its stored token -- so an unpaired
            // visitor learns nothing `/health` does not already say.
            (tiny_http::Method::Get, "/") => html_response(200, &phone_home_page()),
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
            html_response(
                401,
                &pair_form_page(Some("That code was not accepted."), None),
            )
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

/// Hand a paired phone the reminders it should raise alarms for.
///
/// The first endpoint that puts a user's own words on a network, so it is
/// authenticated the same way `/me` is -- read the bearer token, look it up,
/// refuse otherwise -- and it refuses before it reads anything from the
/// database. An unauthenticated request must not be able to make this machine
/// do work, let alone learn what is in it.
///
/// `schedule::build` decides what crosses; see that module for why.
fn handle_schedule(
    request: &tiny_http::Request,
    shared: &Arc<Shared>,
) -> tiny_http::Response<Cursor<Vec<u8>>> {
    let Some(token) = bearer_token(request) else {
        return json_response(401, "{\"error\":\"missing token\"}");
    };

    // Authenticate and stamp last-seen in one pass, then drop the lock before
    // touching the database -- holding two locks in a fixed order is how this
    // stays free of the deadlock that an interleaved stop() could otherwise
    // cause.
    {
        let mut devices = shared.devices.lock().expect("devices poisoned");
        let Some(index) = pairing::find_by_token(&devices, &token) else {
            return json_response(401, "{\"error\":\"unknown token\"}");
        };
        devices[index].last_seen_ms = Some(pairing::now_ms());
        let _ = pairing::save_devices(&shared.devices_path, &devices);
    }

    let offsets = shared
        .prealert_offsets
        .lock()
        .expect("prealerts poisoned")
        .clone();

    let reminders = {
        let store = match shared.reminders.lock() {
            Ok(store) => store,
            Err(_) => return json_response(500, "{\"error\":\"store unavailable\"}"),
        };
        match store.list_reminders() {
            Ok(reminders) => reminders,
            Err(error) => {
                return json_response(500, &format!("{{\"error\":\"{}\"}}", escape_json(&error)))
            }
        }
    };

    let payload = schedule::build(
        &reminders,
        pairing::now_ms(),
        schedule::HORIZON_DAYS,
        offsets,
        PROTOCOL_VERSION,
    );

    match serde_json::to_string(&payload) {
        Ok(body) => json_response(200, &body),
        Err(error) => json_response(
            500,
            &format!("{{\"error\":\"{}\"}}", escape_json(&error.to_string())),
        ),
    }
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

/// Pull one parameter out of a request target's query string.
///
/// A query string is `application/x-www-form-urlencoded` in a different
/// position, so `parse_form` already knows how to read it.
fn query_param(url: &str, key: &str) -> Option<String> {
    let (_, query) = url.split_once('?')?;
    parse_form(query).remove(key)
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

fn pair_form_page(error: Option<&str>, prefill: Option<&str>) -> String {
    let error_html = error
        .map(|message| format!("<p class=\"err\">{}</p>", escape_html(message)))
        .unwrap_or_default();

    // The code arrives from a query string, which anyone can write by hand, so
    // it is clamped to the field's own maxlength and escaped before it goes
    // anywhere near an attribute.
    let (code_value, lead) = match prefill {
        Some(code) => {
            let clamped: String = code.chars().take(8).collect();
            (
                format!(" value=\"{}\"", escape_html(&clamped)),
                "The code is filled in already. Give this phone a name and tap Pair.",
            )
        }
        None => (
            String::new(),
            "Open Settings &rarr; Phone on your computer and start pairing. \
Type the code it shows.",
        ),
    };

    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>Pair with Linodea</title><style>{PAGE_STYLE}</style></head><body><main>\
<h1>Pair with Linodea</h1>\
<p>{lead}</p>\
{error_html}\
<form method=\"post\" action=\"/pair\">\
<label for=\"code\">Pairing code</label>\
<input id=\"code\" name=\"code\"{code_value} autocapitalize=\"characters\" autocomplete=\"off\" \
autocorrect=\"off\" spellcheck=\"false\" inputmode=\"text\" maxlength=\"8\" required>\
<label for=\"device\">Device name</label>\
<input id=\"device\" name=\"device\" value=\"My phone\" maxlength=\"64\">\
<button type=\"submit\">Pair</button>\
</form></main></body></html>"
    )
}

/// Stores the freshly-issued token so the phone view can authenticate.
///
/// The browser is the only client until the Kotlin app exists, and the token is
/// shown exactly once — only its hash is kept on the desktop. Without this the
/// pairing would succeed and then be unusable from the device that just did it.
///
/// `localStorage` is scoped to this server's origin, so nothing but these pages
/// can read it. The token still appears in the page as text, because a person
/// testing with `curl` needs to be able to copy it.
const PAIRED_STORE_SCRIPT: &str = r#"
try {
  localStorage.setItem("linodea.deviceToken", document.getElementById("k").textContent.trim());
  document.getElementById("go").hidden = false;
} catch (e) {
  document.getElementById("nostore").hidden = false;
}
"#;

fn paired_page(name: &str, token: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
<title>Paired</title><style>{PAGE_STYLE}{APP_STYLE}</style></head><body><main>\
<h1>Paired</h1>\
<p><strong>{}</strong> is now paired with this computer. It will show up in Settings \
&rarr; Phone, where you can remove it at any time.</p>\
<a class=\"btn\" id=\"go\" href=\"/\" hidden>See what is scheduled</a>\
<p id=\"nostore\" hidden>This browser will not store the key, so you will have to pair \
again next time. Private browsing usually causes this.</p>\
<p>This is the key this phone will use. It is shown only because a browser has nowhere \
to put it for you &mdash; you do not need to write it down.</p>\
<code id=\"k\">{}</code>\
</main><script>{PAIRED_STORE_SCRIPT}</script></body></html>",
        escape_html(name),
        escape_html(token)
    )
}

/// Extra styling for the phone view. Kept apart from `PAGE_STYLE` so the
/// pairing pages stay as small as they were.
const APP_STYLE: &str = "body.app{place-items:start center}\
main.wide{max-width:32rem;padding-block:24px}\
ul{list-style:none;margin:0;padding:0}\
li{background:#27272a;border:1px solid #3f3f46;border-radius:10px;\
padding:12px 14px;margin:0 0 10px}\
li.chained{border-left:3px solid #a1a1aa}\
.t{font-size:15px;color:#f4f4f5;margin:0 0 4px}\
.w{font-size:13px;color:#a1a1aa;margin:0}\
.tags{margin:6px 0 0;font-size:12px;color:#71717a}\
.muted{color:#71717a;font-style:italic}\
.bar{display:flex;gap:10px;align-items:baseline;margin:0 0 14px}\
.bar p{margin:0}\
a.btn{display:block;text-align:center;text-decoration:none;width:100%;\
box-sizing:border-box;font-size:16px;font-weight:600;padding:12px;\
border-radius:10px;background:#e4e4e7;color:#18181b}";

/// The script behind the phone view.
///
/// The token is held in `localStorage` and sent as a bearer header, exactly as
/// the Kotlin app will. It is deliberately **not** put in the URL: a query
/// parameter would land in the address bar, in history, and in anything the
/// phone syncs from either — for a credential that never expires, that is a
/// real weakening in exchange for nothing.
///
/// Rendering happens here rather than on the server because the page itself is
/// unauthenticated. A server-rendered list would mean `GET /` could hand a
/// reminder title to anyone on the network who opened it.
const PHONE_APP_SCRIPT: &str = r##"
const KEY = "linodea.deviceToken";
const out = document.getElementById("out");
const bar = document.getElementById("bar");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function when(ms) {
  const d = new Date(ms);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return day + " · " + time;
}

async function load() {
  const token = localStorage.getItem(KEY);
  if (!token) {
    out.innerHTML = '<p>This phone is not paired yet.</p><a class="btn" href="/pair">Pair this phone</a>';
    return;
  }
  let res;
  try {
    res = await fetch("/schedule", { headers: { Authorization: "Bearer " + token } });
  } catch (e) {
    out.innerHTML = "<p>Could not reach the computer. Same Wi-Fi?</p>";
    return;
  }
  if (res.status === 401) {
    localStorage.removeItem(KEY);
    out.innerHTML = '<p>This phone was removed on the computer.</p><a class="btn" href="/pair">Pair again</a>';
    return;
  }
  if (!res.ok) {
    out.innerHTML = "<p>The computer answered with an error (" + res.status + ").</p>";
    return;
  }
  const data = await res.json();
  const firing = data.reminders.filter((r) => r.fireAtMs !== null);
  bar.textContent = firing.length
    ? firing.length + " scheduled in the next " + data.horizonDays + " days"
    : "Nothing scheduled in the next " + data.horizonDays + " days";

  if (!data.reminders.length) {
    out.innerHTML = "<p class='muted'>Nothing to show. Capture something on the computer and reload.</p>";
    return;
  }
  out.innerHTML = "<ul>" + data.reminders.map((r) => {
    const time = r.fireAtMs === null
      ? "<p class='w muted'>no alarm — shown for the chain</p>"
      : "<p class='w'>" + esc(when(r.fireAtMs)) + "</p>";
    const rep = r.recurrence
      ? " <span class='muted'>· repeats " + esc(r.recurrence.freq) + "</span>"
      : "";
    const tags = r.tags.length
      ? "<p class='tags'>" + r.tags.map((t) => "#" + esc(t)).join(" ") + "</p>"
      : "";
    return "<li class='" + (r.chainId ? "chained" : "") + "'>"
      + "<p class='t'>" + esc(r.title) + "</p>" + time + rep + tags + "</li>";
  }).join("") + "</ul>";
}

load();
"##;

/// What a phone sees at the root of the link.
///
/// Serves no reminder data itself — everything is fetched by the script above
/// with the device token, so an unpaired phone (or anyone else on the network)
/// opening this address learns only that Linodea is running here, which
/// `/health` already says.
fn phone_home_page() -> String {
    [
        "<!doctype html><html><head><meta charset=\"utf-8\">",
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<title>Linodea</title><style>",
        PAGE_STYLE,
        APP_STYLE,
        "</style></head><body class=\"app\"><main class=\"wide\">",
        "<h1>Linodea</h1>",
        "<div class=\"bar\"><p id=\"bar\">Loading…</p></div>",
        "<div id=\"out\"></div>",
        "</main><script>",
        PHONE_APP_SCRIPT,
        "</script></body></html>",
    ]
    .concat()
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
        let store = crate::data::ReminderStore::in_memory().expect("in-memory store");
        (
            LanService::new(path.clone(), Arc::new(Mutex::new(store))),
            path,
        )
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

    // --- QR encoding ------------------------------------------------------

    #[test]
    fn a_qr_reserves_a_quiet_zone_on_every_side() {
        let qr = qr_image("http://192.168.1.155:7643/pair?code=ABC234").expect("encodes");

        // Every coordinate in the path must sit inside the quiet zone's margin.
        // This is the invariant scanners actually depend on, and it is the one a
        // careless offset would silently break -- the code would still render
        // and still look like a QR, it would just stop scanning reliably.
        let inner_max = qr.size - QUIET_ZONE;
        let mut moves = 0;
        for step in qr.path.split('M').skip(1) {
            moves += 1;
            let (x, rest) = step.split_once(' ').expect("M takes two coordinates");
            let y: u32 = rest
                .split('h')
                .next()
                .expect("y before the run")
                .parse()
                .expect("y is a number");
            let x: u32 = x.parse().expect("x is a number");
            assert!(x >= QUIET_ZONE && x < inner_max, "x {x} outside quiet zone");
            assert!(y >= QUIET_ZONE && y < inner_max, "y {y} outside quiet zone");
        }
        assert!(moves > 0, "a QR with no dark modules is not a QR");
    }

    #[test]
    fn a_qr_merges_horizontal_runs_rather_than_drawing_every_module() {
        let qr = qr_image("http://192.168.1.155:7643/pair?code=ABC234").expect("encodes");

        let runs: Vec<u32> = qr
            .path
            .split('M')
            .skip(1)
            .map(|step| {
                step.split_once('h')
                    .expect("every subpath carries a run length")
                    .1
                    .split('v')
                    .next()
                    .expect("run length before the close")
                    .parse()
                    .expect("run length is a number")
            })
            .collect();

        let dark: u32 = runs.iter().sum();
        // Guards the IPC payload: this string is re-sent on every re-render of
        // the pairing panel, and one subpath per dark module would roughly
        // double it for no visual difference.
        assert!(
            (runs.len() as u32) < dark,
            "{} subpaths for {dark} dark modules -- runs are not merging",
            runs.len()
        );
        // The finder patterns are 7 modules wide, so a correctly merged path
        // must contain at least one run that long.
        assert!(
            runs.iter().any(|&run| run >= 7),
            "no run reached the width of a finder pattern: {runs:?}"
        );
    }

    #[test]
    fn a_longer_url_still_encodes_and_grows_the_code() {
        let short = qr_image("http://10.0.0.2:7643/pair?code=ABC234").expect("encodes");
        let long = qr_image("http://192.168.100.155:7643/pair?code=ABC234").expect("encodes");
        assert!(long.size >= short.size);
    }

    #[test]
    fn text_past_the_qr_capacity_is_refused_rather_than_panicking() {
        // A QR tops out around 2953 bytes at the lowest error correction; this
        // is well past any version of it.
        let far_too_long = "x".repeat(8_000);
        assert!(qr_image(&far_too_long).is_err());
    }

    // --- query parameters -------------------------------------------------

    #[test]
    fn a_pairing_code_is_read_out_of_the_query_string() {
        assert_eq!(
            query_param("/pair?code=ABC234", "code").as_deref(),
            Some("ABC234")
        );
        assert_eq!(
            query_param("/pair?other=1&code=XY7Z89", "code").as_deref(),
            Some("XY7Z89")
        );
        assert_eq!(query_param("/pair", "code"), None);
        assert_eq!(query_param("/pair?code=", "code").as_deref(), Some(""));
        // Same decoding as a form body, since it is the same encoding.
        assert_eq!(
            query_param("/pair?code=A%20B", "code").as_deref(),
            Some("A B")
        );
    }

    #[test]
    fn a_scanned_link_arrives_with_the_code_already_in_the_form() {
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        let code = service.begin_pairing().code.expect("code is offered");

        let response = fetch(status.port, &format!("/pair?code={code}"));
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(
            response.contains(&format!("value=\"{code}\"")),
            "code should be prefilled, got: {response}"
        );

        // And without the parameter the field stays empty rather than carrying
        // a stale value.
        let bare = fetch(status.port, "/pair");
        assert!(!bare.contains("value=\"\""), "got: {bare}");
        assert!(bare.contains("name=\"code\" autocapitalize"), "got: {bare}");

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_prefilled_code_cannot_inject_markup_or_overflow_the_field() {
        // The query string is writable by anyone who can reach the port, so the
        // prefill is the one place untrusted text meets an HTML attribute.
        let hostile = pair_form_page(None, Some("\"><script>alert(1)</script>"));
        assert!(!hostile.contains("<script>"), "got: {hostile}");
        // Clamped first, then escaped -- escaping first and cutting afterwards
        // could slice an entity in half and produce the markup it was meant to
        // prevent.
        assert!(
            hostile.contains("value=\"&quot;&gt;&lt;scrip\""),
            "got: {hostile}"
        );

        // Clamped to the field's own maxlength so a megabyte of query string
        // cannot become a megabyte of page.
        let long = pair_form_page(None, Some(&"A".repeat(500)));
        assert!(long.contains("value=\"AAAAAAAA\""), "got: {long}");
        assert!(!long.contains("AAAAAAAAA"), "should clamp to 8 characters");
    }

    // --- reachability probe -----------------------------------------------

    #[test]
    fn a_running_server_answers_its_own_probe() {
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");

        assert!(probe_one("127.0.0.1", status.port, PROBE_TIMEOUT));

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_port_with_nothing_behind_it_fails_the_probe() {
        // Bind and drop: the port is real and almost certainly still free, so
        // the connect is refused rather than left hanging.
        let port = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
            listener.local_addr().expect("addr").port()
        };
        assert!(!probe_one("127.0.0.1", port, Duration::from_millis(250)));
    }

    #[test]
    fn something_else_squatting_on_the_port_does_not_pass_as_our_server() {
        // This is the reason the probe sends a real request instead of just
        // connecting: a bare connect would call this address healthy.
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let squatter = std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                drop(stream);
            }
        });

        assert!(!probe_one("127.0.0.1", port, Duration::from_millis(500)));
        let _ = squatter.join();
    }

    #[test]
    fn a_stopped_server_reports_every_address_as_unreachable() {
        let (service, path) = temp_service();

        // No socket is bound, so nothing can answer -- and the probe must say so
        // instantly rather than spending a timeout per address proving it.
        let started = std::time::Instant::now();
        let probes = service.probe_addresses();
        assert!(
            started.elapsed() < PROBE_TIMEOUT,
            "a stopped server should not be probed over the network"
        );
        assert!(probes.iter().all(|probe| !probe.reachable));
        assert_eq!(probes.len(), local_addresses().len());

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_unparseable_address_is_dead_rather_than_a_panic() {
        assert!(!probe_one("not-an-ip", 7643, Duration::from_millis(50)));
    }

    #[test]
    fn the_path_redraws_into_a_real_qr_code() {
        // Paint the path back onto a grid and look for the three finder
        // patterns -- the 7x7 bullseyes a camera uses to locate and orient a
        // code. Nothing else here proves the flattening is correct: an off-by-one
        // in the run merging, a swapped x and y, or a wrong quiet-zone offset all
        // still produce a plausible-looking field of squares, and the only symptom
        // would be a code that quietly refuses to scan.
        let qr = qr_image("http://192.168.1.155:7643/pair?code=ABC234").expect("encodes");
        let size = qr.size as usize;
        let mut grid = vec![vec![false; size]; size];

        for step in qr.path.split('M').skip(1) {
            let (x, rest) = step.split_once(' ').expect("M takes two coordinates");
            let (y, rest) = rest.split_once('h').expect("a run follows the move");
            let (run, back) = rest.split_once("v1h-").expect("the run closes on itself");
            let x: usize = x.parse().expect("x is a number");
            let y: usize = y.parse().expect("y is a number");
            let run: usize = run.parse().expect("run is a number");
            assert_eq!(
                back.trim_end_matches('z'),
                run.to_string(),
                "a subpath must return exactly as far as it advanced"
            );
            for column in grid[y].iter_mut().skip(x).take(run) {
                *column = true;
            }
        }

        const FINDER: [&str; 7] = [
            "#######", "#     #", "# ### #", "# ### #", "# ### #", "#     #", "#######",
        ];
        let quiet = QUIET_ZONE as usize;
        let modules = size - quiet * 2;
        let corners = [(0, 0), (0, modules - 7), (modules - 7, 0)];
        for (top, left) in corners {
            for (row, expected) in FINDER.iter().enumerate() {
                for (column, mark) in expected.chars().enumerate() {
                    assert_eq!(
                        grid[quiet + top + row][quiet + left + column],
                        mark == '#',
                        "finder pattern at ({top}, {left}) is wrong at ({row}, {column})"
                    );
                }
            }
        }

        // And the margin really is a margin.
        for (y, row) in grid.iter().enumerate() {
            for (x, dark) in row.iter().enumerate() {
                let in_margin = y < quiet || y >= size - quiet || x < quiet || x >= size - quiet;
                assert!(!(in_margin && *dark), "a module landed in the quiet zone");
            }
        }
    }

    // --- the schedule endpoint --------------------------------------------

    fn seed_reminder(service: &LanService, id: &str, title: &str, scheduled_at: &str) {
        let store = service.shared.reminders.lock().expect("store");
        store
            .create_reminder(crate::data::ReminderNode {
                id: id.to_string(),
                user_id: None,
                title: title.to_string(),
                raw_input: format!("{title} -- raw capture"),
                description: Some("private notes".to_string()),
                scheduled_at: scheduled_at.to_string(),
                timezone: "Asia/Jakarta".to_string(),
                reminder_type: "main".to_string(),
                status: "pending".to_string(),
                tags: vec!["skripsi".to_string()],
                parent_id: None,
                previous_id: None,
                next_id: None,
                checklist: vec!["a secret step".to_string()],
                recurrence: None,
                confidence: 1.0,
                created_at: "2026-01-01T00:00:00.000Z".to_string(),
                updated_at: "2026-01-01T00:00:00.000Z".to_string(),
                completed_at: None,
                snoozed_until: None,
                created_on_device_id: "desktop".to_string(),
                sync_version: 1,
            })
            .expect("seeded");
    }

    /// An ISO timestamp `days` from now, so a seeded reminder is genuinely
    /// inside the horizon at the moment the test runs.
    fn iso_in_days(days: i64) -> String {
        let ms = crate::pairing::now_ms() + days * 24 * 60 * 60 * 1000;
        chrono::DateTime::from_timestamp_millis(ms)
            .expect("in range")
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    fn pair_and_take_token(service: &LanService, port: u16) -> String {
        let code = service.begin_pairing().code.expect("code is offered");
        let response = post_form(port, "/pair", &format!("code={code}&device=HP"), false);
        response
            .rsplit_once("\"token\":\"")
            .and_then(|(_, rest)| rest.split('"').next())
            .expect("token in response")
            .to_string()
    }

    #[test]
    fn the_schedule_is_refused_without_a_valid_token() {
        // The first endpoint carrying a user's own words, so this is the test
        // that matters most: no token, a junk token and a revoked one all get
        // nothing, and none of them learn whether the database even has rows.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        seed_reminder(&service, "a", "Kumpul draft skripsi", &iso_in_days(1));

        assert!(fetch(status.port, "/schedule").starts_with("HTTP/1.1 401"));
        let bogus = fetch_with_token(status.port, "/schedule", "not-a-real-token");
        assert!(bogus.starts_with("HTTP/1.1 401"), "got: {bogus}");
        assert!(!bogus.contains("skripsi"), "a refusal must reveal nothing");

        let token = pair_and_take_token(&service, status.port);
        assert!(fetch_with_token(status.port, "/schedule", &token).starts_with("HTTP/1.1 200"));

        // Revoking is immediate, because every request re-reads the device list.
        let device = service.pairing_state().devices[0].id.clone();
        service.forget_device(&device).expect("revoked");
        let after = fetch_with_token(status.port, "/schedule", &token);
        assert!(after.starts_with("HTTP/1.1 401"), "got: {after}");
        assert!(
            !after.contains("skripsi"),
            "a revoked phone must learn nothing"
        );

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_paired_phone_is_sent_titles_and_times_but_never_notes() {
        // The privacy decision, pinned at the HTTP boundary as well as in the
        // builder -- this is the surface that actually reaches a network.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        seed_reminder(&service, "a", "Kumpul draft skripsi", &iso_in_days(1));
        let token = pair_and_take_token(&service, status.port);

        let response = fetch_with_token(status.port, "/schedule", &token);
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("Kumpul draft skripsi"));
        assert!(response.contains("\"fireAtMs\""));
        assert!(response.contains("\"skripsi\""), "tags travel");
        assert!(!response.contains("private notes"), "description leaked");
        assert!(!response.contains("a secret step"), "checklist leaked");
        assert!(!response.contains("raw capture"), "raw input leaked");

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pulling_the_schedule_marks_the_phone_as_seen() {
        // Until this endpoint existed nothing authenticated after pairing, so
        // last-seen was permanently null and "my phone stopped ringing" had no
        // evidence either way.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        let token = pair_and_take_token(&service, status.port);
        assert!(service.pairing_state().devices[0].last_seen_ms.is_none());

        let response = fetch_with_token(status.port, "/schedule", &token);
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(service.pairing_state().devices[0].last_seen_ms.is_some());

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_desktops_prealert_offsets_reach_the_phone() {
        // They live in localStorage, so the frontend has to hand them over. If
        // this breaks, the phone silently drops every early warning and looks
        // like it is firing late.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        service.set_prealert_offsets(vec![1440, 60]);
        let token = pair_and_take_token(&service, status.port);

        let response = fetch_with_token(status.port, "/schedule", &token);
        assert!(
            response.contains("\"prealertOffsetsMinutes\":[1440,60]"),
            "got: {response}"
        );

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_empty_schedule_is_an_answer_rather_than_an_error() {
        // The phone must be able to tell "nothing scheduled" from "the request
        // failed" -- otherwise a quiet evening looks like a broken link.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        let token = pair_and_take_token(&service, status.port);

        let response = fetch_with_token(status.port, "/schedule", &token);
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("\"reminders\":[]"), "got: {response}");

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    // --- the phone's own view ---------------------------------------------

    #[test]
    fn the_phone_view_serves_no_reminder_data_of_its_own() {
        // The page is unauthenticated, so it must render nothing on the server.
        // If it ever did, opening the address would hand a reminder title to
        // anyone on the network -- which is the whole thing the token prevents.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        seed_reminder(&service, "a", "Kumpul draft skripsi", &iso_in_days(1));

        let response = fetch(status.port, "/");
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("text/html"), "a phone gets a page");
        assert!(
            !response.contains("Kumpul draft skripsi"),
            "the unauthenticated page rendered a reminder: {response}"
        );
        // It fetches with the token instead.
        assert!(response.contains("Bearer"), "got: {response}");

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn pairing_hands_the_browser_the_token_it_will_need() {
        // The token is shown exactly once and only its hash is kept, so if the
        // paired page did not store it the pairing would succeed and then be
        // useless from the very device that just completed it.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");
        let code = service.begin_pairing().code.expect("code is offered");

        let response = post_form(
            status.port,
            "/pair",
            &format!("code={code}&device=HP"),
            true,
        );
        assert!(response.starts_with("HTTP/1.1 200"), "got: {response}");
        assert!(response.contains("localStorage.setItem"), "got: {response}");
        assert!(response.contains("linodea.deviceToken"), "got: {response}");
        // And still printed, because a person testing by hand needs to copy it.
        assert!(response.contains("id=\"k\""), "got: {response}");

        service.stop();
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_root_is_a_page_and_unknown_paths_are_still_refused() {
        // Adding a route at "/" must not turn the 404 into a catch-all that
        // answers anything -- that check has guarded this server since S86.
        let (service, path) = temp_service();
        let status = service.start_on("0.0.0-test".into(), &[0]).expect("bind");

        assert!(fetch(status.port, "/").starts_with("HTTP/1.1 200"));
        assert!(fetch(status.port, "/reminders").starts_with("HTTP/1.1 404"));
        assert!(fetch(status.port, "/schedule/all").starts_with("HTTP/1.1 404"));

        service.stop();
        let _ = std::fs::remove_file(&path);
    }
}
