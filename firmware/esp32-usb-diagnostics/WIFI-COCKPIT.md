# Direct Wi-Fi cockpit (0.4.8 packaging candidate; operator last confirmed 0.4.6)

Stationary IMU capture is documented in [WIFI-CALIBRATION.md](WIFI-CALIBRATION.md).
It adds a read-only buffered Wi-Fi capture and local validation/export; calibration
remains inactive. The operator has used capture and OTA on the installed 0.4.6.
The joined E2E plan is [programmatic drone flight](prd-tad-adr-mvp-gtm-programmatic-drone-flight.md), `GAMEXR-FLIGHT-PATH-INTEGRATION-001@0.2.1`.

The ESP32 serves a dedicated Wi-Fi Drone cockpit at `/gamexr/`. Its main joystick, throttle,
Start/Pause, BRAKE and Enable Motion own the authenticated Wi-Fi bench session.
The connection panel contains status and camera only; there is no second set of
flight controls. Physical motor GPIOs remain low and held. The HUD shows IMU
sequence, bench throttle, zero yaw and motors OFF. No game engine, canvas, scenery
or spacecraft loads in this mode. Game Mode is an explicit `/gamexr/game.html`
navigation and loads the preserved simulation separately. Leaving Drone mode stops
the bench session; returning requires the private pairing link and explicit Start.

1. Keep the previously confirmed propeller removal and motor-power isolation.
   Join `XW_Drone_WiFi`, password `12345678`; stay connected without internet.
2. Open the private pairing link at `https://192.168.4.1:8443/gamexr/` with the
   GameXR CA trusted. The key stays in page memory and is removed from history.
   Reopen that link after reload. The unpaired page still displays live IMU.
3. Motion is the default preference. Tap the main **Enable Motion**, grant Safari
   permission and hold the phone comfortably until calibrated. Alternatively,
   touch the main **PITCH · ROLL** joystick to select Touch mode explicitly.
4. Wait for live IMU, then tap main **Start**. Every session starts at zero
   throttle. Move the phone or joystick, then adjust **BENCH THROTTLE**. Full
   slider range means 20% maximum virtual output; yaw remains zero. The joystick
   springs to neutral on release. Changing input mode stops and requires Start.
5. **Pause**, **BRAKE**, Reset, pointer cancellation, switching apps, stale
   motion/IMU, rejected ACKs or disconnection revoke the session. The board also
   expires its command lease after 250ms. Start is always explicit, including
   after BFCache restore. The connection panel stops control when opened.

Camera preview uses the phone camera; frames stay in the browser. The old read-only
page remains at `/diagnostics`. HTTP port 8080 redirects `/` to the HTTPS cockpit.
No Mac gateway or USB data connection is needed during Wi-Fi operation; a board
power source is still needed. This does not enable powered flight.

## Historical settings and provenance

“Historical v0.1.0” is the user's label, not a verified vendor release tag. The
matching vendor application has metadata `14a0af9`; the source reference is commit
`89624582e8569460eb131ff68ec05d12e7114dc8`. Its application matched the original
USB backup byte-for-byte. The earlier live USB parameter dump also confirms the
listed PID gains and flight limits. The 78 captured parameters, including IMU
calibration, are preserved in [historical-flight-reference.json](historical-flight-reference.json).
Five non-finite receiver mappings are explicitly null and are never applied.
Web sensitivity values are source defaults; they were not in that live dump.
None of these observations establishes a verified flight tune for the new code.

| Setting | Historical source default | This build |
| --- | --- | --- |
| Axis expo | 40% cubic blend | Reused |
| Axis dead zone | 6%, after expo | Reused once |
| Roll/pitch sensitivity | 0.85 | Reused |
| Yaw sensitivity | 0.68 | Reused |
| Throttle scale / low dead zone | 1.0 / 6% | Reused within bench cap |
| Stick nominal angular range | ±30° | Reference only; new phone tilt span ±30° |
| Tilt limit | 30° | Reference only |
| Roll/pitch rate maximum | 360°/s | Reference only; bench ceiling 1 rad/s |
| Yaw rate maximum | 300°/s | Reference only |
| Roll rate P/I/D / integral bound | .06/.2/.002 / .35 | Reference only |
| Pitch rate P/I/D / integral bound | .05/.2/.001 / .35 | Reference only |
| Yaw rate P/I/D / integral bound | .3/.01/.01 / .3 | Reference only |
| Roll/pitch angle P/I/D | 7/0/0 | Reference only |
| Yaw angle P | 3 | Reference only |
| Historical UI send / keepalive | 50ms / 200ms | New bench sends ~100ms, lease 250ms |

Numeric facts come from the retained reference-source files `web_rc.ino`
(SHA256 `14a5e3d6e292a42a311d8edd0d4a33e71c406883f968ac62e36816e90d1dff92`),
`web_rc_html.h` (`51dc492d267ab3688570460ddf66cb4c2a3388c61c2453f0ba377c9dcdaa32a5`),
and `control.ino` (`c0fa7f7f42ce61c79154390403a60de8738b270418793e2737d85330f7736361`).
The implementation is independently written MIT code. Restricted vendor algorithms
are not imported. The old angle/stabilization controller and new rate bench have
different units, estimator, timing and motor behavior; identical response is not claimed.

## Build and transport contract

Run `tools/package-cockpit.mjs PHONE_CHECKOUT ARTIFACT_DIRECTORY` with Node 24 from
the admitted firmware checkout. The phone checkout must be clean at
the revision in `cockpit-source.lock.json`, with its matching owner-sealed build.
The packager verifies the source revision, clean state, artifact digest, exact file
inventory and each file's bytes/hash before packaging. It does not rebuild the
parallel owner's checkout. GameXR path execution remains host simulation only;
the ESP32 has no path receiver, position estimator or motor-enabled controller.
Vite minifies the new extension, reusing the owner's Motion and Camera modules.
The packager binds the existing integrity-checked offline cache to drone-only
assets. Gaming assets remain on the ESP32 and are requested only in Game Mode.
Game Mode needs its board connection; its full asset set is not eagerly cached.
The packager refreshes manifest digests and gzips each asset. Generated files, previews, private TLS/key inputs and build receipts belong
in canonical `GameXR/.artifacts`; ignored `generated`/`private` links bind the build.
Private inputs: `server.pem`, `server-key.pem`, `ca.cer`, `control-key.txt` (64 hex
bytes without newline). Never commit these or the private pairing link.

HTTPS `POST /api/bench` requires exact Host and Origin for port 8443 and
`X-GXR-Key`. Body is one printable ASCII `GXR1` command without newline, at most
95 bytes. No CORS, no commands on HTTP. The existing USB bench schema documents
units and ACKs in [USB-BENCH.md](USB-BENCH.md). Both transports use separate RAM
models. The application samples IMU and ticks the Wi-Fi watchdog every 10ms; locks
cover only bounded RAM calculations, never network operations.

Packaging cap: 300kB gzip total, 250kB per compressed asset. App0 cap: 0x140000.
Flash only the validated app at 0x10000, with exact chip binding, current full
backup verification and protected-range comparisons. NVS, bootloader, partition
table, alternate app and SPIFFS are preserved. Use the retained predecessor app
and full snapshot for recovery, not a guessed board image or erase-all.

USB-integrity investigation and battery calibration remain KIV. Real phone Wi-Fi
latency, motion signs, STOP/background/disconnect behavior and camera acceptance
must be observed separately; host tests and a USB flash do not prove them.

## Observed device status, 2026-09-25

0.4.0 app write and protected-range verification passed; the device reported that
version at boot. The operator loaded the full cockpit in iPhone Safari, then
read a valid `/api/telemetry` response: session 3667260253, sequence 2880, age 101ms,
IMU OK and physical outputs inhibited. Live telemetry did not appear in the panel.

0.4.1 accepts that exact captured response in a regression test. Initial telemetry
and HELLO requests allow 1500ms for HTTPS setup, while SET ACKs retain 180ms,
control freshness remains 500ms and the device lease remains 250ms. Transport time
counts toward sample age. Hashed extension filenames avoid old service-worker
assets after an update. These are candidate fixes pending real-phone acceptance.
The first 0.4.1 upload attempt failed opening USB before any write. The exact image,
source snapshot, checks and attempt receipt remain in the final artifact directory.

Final update: upload attempt 3 wrote and verified the exact 0.4.1 image, requested
application boot, and verified both protected flash ranges unchanged. The fresh
4MiB backup is SHA256
`c5ffb382f3cf96fca2c4ba59781dfd2e17e74c4c6643f4d923312507a59a7c20`.
Attempt 1 failed opening USB; attempt 2 stopped in recovery-file preflight before
device I/O. Both unsuccessful receipts remain intact. Direct iPhone acceptance of
0.4.1 IMU/ACK/STOP is pending; successful flash is not flight-control acceptance.

## Main controls successor, 0.4.2

The pinned shell's input events are claimed during document capture before its
simulator target handlers. No DOM clones or simulation telemetry become commands.
The simulator is paused through its existing control contract. Original Motion
and Camera modules remain reused; a small adapter owns the embedded board mode.
Startup has a 20-second bound and fails closed if the shell contract is missing.
The browser fetch receiver is preserved for HELLO, SET and STOP; a regression test
covers the receiver bug discovered during real browser preview testing.

The loopback preview has a separately keyed synthetic receiver and an explicit
NO DEVICE CONNECTION banner. It exercises the main controls without USB/network
proxying. Actual phone motion and direct Wi-Fi acceptance remain independent.
The 0.4.2 build/flash and browser evidence are retained under canonical
`GameXR/.artifacts/wifi-main-controls-2026-09-25`; exact status is in its handoff.

0.4.3 adjusts the phone status/connection-button placement and reasserts the bench
HUD after renderer resize. Final evidence: `wifi-main-controls-2026-09-25-final`.

## Dedicated drone entry, 0.4.4

The drone entry directly mounts a small shell and reuses Motion, Camera, input
state and the existing bench client. There is no simulation boot, hidden WebGL
renderer, scene initialization, game preload or game precache. The old startup
observer and simulator-event interception are retired. Game Mode owns its original
entry and assets; no drone command key or active session transfers to it.
The drone entry/cache payload is 19,820 gzip bytes; all optional game assets remain
within the existing 300kB total device packaging ceiling. Desktop browser network
evidence shows only drone CSS/JS, development tooling and live telemetry requests,
and zero canvas elements. Firmware and verification evidence belong under
`GameXR/.artifacts/wifi-drone-mode-2026-09-25`.
