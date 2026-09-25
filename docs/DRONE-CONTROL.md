---
title: "Reference implementation — local drone control bench"
doc_type: "Runbook"
version: "0.2.0"
date: "2026-09-14"
lang: "en-US"
owner: "Interface/protocol maintainer"
frontmatter_contract: "required"
continuity_id: "DRONE-RC-001"
local_rung: "dev-proven"
delivered_rung: "undocumented"
verification_scope: "Motor-disabled host fixture only"
---

# Reference implementation — GameXR drone bench

The Drone panel sends independent setpoints through a local WebSocket bridge and real
UDP to a separate simulated receiver process. It verifies the host control path, command
admission and loss handling. **It cannot connect to a physical drone or produce motor outputs.**

The selected product direction remains local Wi-Fi with flight control on the ESP32.
The board, IMU, motor driver/ESC and onboard receiver profile are still required to
implement that link. The full [PRD–TAD–ADR–MVP–GTM plan](drone/prd-tad-adr-mvp-gtm-gamexr-esp32-drone-control.md)
keeps physical acceptance separate from the implemented host checks.

## Reference implementation — run locally

Use Node **24.15 or later in the 24 LTS line** for the TypeScript bridge and tests.
From the GameXR source candidate:

```sh
npm ci
npm run check
npm run drone:bench
```

Open [the local bench](http://127.0.0.1:4192/gamexr/). Choose **Drone → Connect receiver →
Enable bench control**. Change roll, pitch, yaw and throttle, then inspect the accepted
setpoints and sequence. **Disable control** returns all four axes to zero. Closing the
panel destroys its session and in-memory log; reopening requires connect and enable.
Use **Export session log** before closing to save the last 1,000 events locally.

Stop the bridge with Ctrl+C. A different loopback port can be selected:

```sh
npm run drone:bench -- --port=4292
```

The CLI has no hardware/backend/UDP-target option. `npm run dev`, static hosting and
the public website can show the panel, but the bench connection requires the local
bridge URL. A phone cannot reach another computer's loopback address. Use the paired
HTTPS gateway below for phone access to the simulated bench.

## Reference implementation — control and telemetry

The panel uses absolute throttle 0–1 and independent signed axes −1–1. Steering has a
6% dead zone. Game throttle accumulation, automatic yaw coupling, Brake, motion input
and `window.gameXR`/WebMCP commands never feed this session. No LLM is in the command loop.

Bench conversion is roll/pitch ±10°, yaw ±45°/s, thrust 0–10,000 units. These are fixture
limits, not an aircraft calibration or safe flight envelope. The independent codec
uses the legacy 16-byte CRTP RPYT packet layout, but **the authenticated fixture envelope
is not a stock ESP-Drone protocol**. Replacing a hostname is not a supported hardware port.
The upstream legacy receiver also negates yaw; actual axes, arming and thrust semantics
must be reviewed against the exact firmware, mixer and airframe.

Telemetry reports the fixture identity, acknowledged sequence, accepted setpoints and
sample age. Battery and measured attitude are explicitly unavailable. No game flight
model or invented sensor values stand in for aircraft measurements.

The browser sends at most one command per new receiver challenge on a 40 ms timer.
The bridge grants one pilot session and rejects unknown fields, wrong profiles,
duplicate/reordered sequences and stale/replayed challenges. An independently running
receiver checks its own one-use challenge age and 250 ms command lease. Invalid traffic
does not renew that lease. The receiver and bridge sample their timers every 40 ms;
host scheduling can delay observation. This is not a hard real-time flight guarantee.

Focus loss, hidden page, cancelled pointer input, controller disconnect, panel closure,
socket loss or browser stall inhibit the bench session and clear throttle. Reconnect
never restores authority automatically. The receiver resets on its own deadline if
the page or bridge stops sending, even when a disable message cannot arrive.

UDP sockets bind to 127.0.0.1; HTTP does by default. The optional paired HTTPS server
binds only one explicitly selected private IPv4 interface. The bridge validates Host and WebSocket Origin,
limits inbound messages to 1 KiB and 80/s per client, and admits at most four clients.
UDP packets use a random per-run HMAC key shared only with the child process via IPC.
This protects the fixture channel; it is not a paired aircraft identity system and
does not defend against a malicious process running under the same local account.

## Reference implementation — verify

```sh
npm run check
npm run check:apex
npx playwright install webkit
npm run test:webkit
npm run test:drone-browser
```

The drone browser suite expects the `/gamexr/` build from `npm run check`. It starts
its own fixture on port 4193. The original browser suite uses port 4187 and retains
its existing release and offline checks. Run them sequentially because they share
the test-results directory. No hardware is discovered or flashed by these commands.

- `tests/drone-protocol.test.ts`: strict axes/profile validation, an independently
  checked wire vector/checksum, envelope tampering, exact deadline, replay/reorder,
  wrong-owner and malformed-frame rejection. Four rejection faults plus silence have
  20 deterministic receiver-clock trials each; these are not physical fault trials.
- `tests/drone-bridge.test.ts`: actual child receiver, UDP and WebSocket transport;
  ownership, reconnect, malformed input, replay, receiver death, origin/Host/path
  restrictions and payload limit. Host transport settling allows up to one second;
  the exact 250 ms state-machine boundary is checked separately.
- `drone-browser-tests/bench.spec.ts`: mobile WebKit controls and display, four input
  loss events, game API isolation, close/reconnect, export and browser event-loop stall.

Exact results and source digests are recorded in [host evidence](drone/evidence/validation.json).
The browser profile emulates iPhone 13; it is not physical iPhone or Wi-Fi certification.
Existing native code and dependency pins are unchanged; their full Apple device matrix
was not rerun for this host feature.

## Reference implementation — complete the aircraft adapter

The next required input is the **board/drone model and revision, IMU, motor driver or
ESC, battery measurement hardware, and existing firmware if any**. Then:

1. Prove a board-compatible firmware baseline with props removed, recording its exact
   source/SDK/configuration, sensor health and inhibited outputs (E1).
2. Implement and review an onboard freshness/ownership receiver alongside the flight
   controller. Keep stabilization, mixing and command-loss handling on the ESP32.
   The host fixture's JSON/HMAC envelope is only a test design, not a firmware module.
3. Define actual axis signs, units, arm/disable actions, sensor-derived telemetry and
   aircraft-specific loss behavior. Implement one fixed physical transport profile.
4. Run the original mapping, loss, telemetry, isolation and timed setup checks E2–E6.
   Only then conduct the separately instructed aircraft-specific flight acceptance E7.

Do not map the game's Brake or a routine lost-focus event directly to an airborne
motor cut. The bench's neutralization has no aircraft recovery meaning until the
selected onboard firmware and rig prove it.

## Reference implementation — source and licensing

Protocol facts were checked against [ESP-Drone communication documentation](https://docs.espressif.com/projects/espressif-esp-drone/en/latest/communication.html)
and the [pinned legacy receiver](https://github.com/espressif/esp-drone/blob/db0f6562e4f67cccee3acac4dff39c9aaea4e5fa/components/core/crazyflie/modules/src/crtp_commander_rpyt.c).
The [pinned upstream README](https://github.com/espressif/esp-drone/blob/db0f6562e4f67cccee3acac4dff39c9aaea4e5fa/README.md)
documents its board/SDK baseline and limited support. This candidate includes no
copied GPL flight implementation. New host code remains MIT; any future firmware
reuse retains its upstream license. New dependencies are exact `ws@8.21.3` and
`@types/ws@8.18.1`, both MIT, with lockfile integrity.

CLion and the earlier paoloach/ESP32 IDE-plugin reference remain optional development
inspiration in the parent firmware-tooling plan. They neither supply onboard flight
control nor belong in this runtime. The existing native ESP-IDF build workflow remains
the firmware build owner; its heartbeat starter is not converted into a flight stack.

## Graph flight path → GameXR → simulated receiver

1. In Graph's Python workspace, select **Drone flight and landing**, program the route
   (or **Load flight example**), and **Run**. Finish without collisions and land.
2. In **Results**, choose **Export flight path for GameXR**. Transfer that JSON file
   to iPhone Files using your usual local transfer method.
3. Open this GameXR candidate through the bench gateway. Choose **Drone**, import the
   file, inspect its path/duration, then **Connect receiver → Run flight path**.
4. The preview follows receiver-accepted simulated positions. Completion requires an
   acknowledged landed final sample. **Disable control** stops early. Keep Safari in
   the foreground; focus loss, hidden page, stale telemetry and disconnect cancel Run.
   A new Run always begins at the origin; no automatic resumption is supported.

For iPhone on the same Wi-Fi, reuse the certificate setup in
[the phone gateway runbook](USB-TELEMETRY.md). The certificate must cover the Mac's
selected private IP and be trusted on the phone. Do not bypass Safari trust warnings.
After building the candidate, start the simulated bench with your existing files:

```sh
npm run drone:bench -- --listen=YOUR_MAC_PRIVATE_IP --tls-cert=/absolute/path/cert.pem --tls-key=/absolute/path/key.pem
```

Use the private one-use pairing link printed locally; it expires after 15 minutes.
Pairing creates an in-memory browser session lasting one hour. Keep the TLS private
key readable only by its owner. No router port forwarding or Internet service is needed.
The receiver still runs on the Mac over loopback UDP with no motor outputs. This is
phone-to-Mac Wi-Fi delivery of simulated setpoints, not radio delivery to an aircraft.

The importer accepts Graph's `agentic-drone-flight-path/v1` contract, at most 500 kB,
7,201 samples and 120 seconds. It does not execute Python or translate positions into
throttle. The maximum planned translation is 3 m/s within ±8 m horizontal and 0–4 m
altitude; these are educational bounds. Path sessions cannot mix with manual axes.
See [the implementation plan](drone/prd-tad-adr-mvp-gtm-drone-flight-path.md) for acceptance.
