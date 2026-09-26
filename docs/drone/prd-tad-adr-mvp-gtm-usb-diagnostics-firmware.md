# USB diagnostics firmware implementation

Continuity: GAMEXR-USB-DIAGNOSTICS-FIRMWARE-001@0.3.3.
Parent: DRONE-RC-001@0.2.0. Scope: new native firmware project, build and host checks;
physical loading and flight control are separate effects.

## Current priorities, 2026-09-26

Active: E2E source convergence, GAMEXR-FLIGHT-PATH-INTEGRATION-001@0.2.2;
PRD/TAD/ADR/MVP/GTM: [joined plan](../../firmware/esp32-usb-diagnostics/prd-tad-adr-mvp-gtm-programmatic-drone-flight.md).
0.4.8 is a build-only candidate. Physical paths and motor actuation remain unavailable.
USB bootstrap verified; operator confirms OTA 0.4.7 and manual recovery to 0.4.6.
OTA physical validation: GAMEXR-WIFI-OTA-001@0.1.5, WIFI-OTA.md; automatic rollback untested.
Capture: GAMEXR-WIFI-IMU-CAPTURE-001@0.1.2, WIFI-CALIBRATION.md; gyro inactive.
Phone/USB repeat passed diagnostic bound; matched warm-up and physical axes remain pending.
Battery calibration/USB fault remain KIV. Propellers removed and motors isolated.
Evidence: GameXR/.artifacts/wifi-ota-{transport,phone}-2026-09-26. No device effect this pass.

## PRD

Implement the user-approved first milestone: boot, read IMU and battery, emit USB
telemetry, and keep motor outputs inhibited. Use FOSS dependencies and documented
hardware facts without copying the restricted flight implementation. Initial sprint
target: 20 minutes, one native firmware project, no module above 600 lines, authored
chunks below 500 kB. Source uses an admitted GameXR worktree; outputs and receipts
use the explicit GameXR/.artifacts storage exception. Zero spend.

## TAD

A standalone ESP-IDF 6.1 project lives in firmware/esp32-usb-diagnostics. Hardware
I/O, MPU register logic, telemetry formatting and boot orchestration are separate.
The native SDK supplies GPIO/SPI/ADC/FreeRTOS/UART console services. A portable C
core enables host fault tests through the repository's existing npm-test entrypoint.
No managed components, runtime MCP, receiver or persisted settings are introduced.
Version 0.2.0 adds the official SDK AP and HTTP/HTTPS servers, a locked latest-sample
buffer, and a small embedded browser page. Sensor coordinates remain untransformed;
units and errors are explicit. Configuration and PHY calibration stay in RAM.

## ADR

- Use the already installed official ESP-IDF 6.1 at the locked commit for this new
  project; preserve the original Arduino 3.3.8 firmware and backups unchanged.
- Keep aircraft diagnostics as its own build target inside the GameXR repository,
  separate from browser/host code. The historical starter is not present locally.
- Assert zero motor gates before sensor setup, then hold them; no arming or PWM path.
  Software startup cannot certify pre-application pin state or power isolation.
- Accept MPU-6500 identity 0x70 only; fail clearly on mismatched configuration,
  missing data-ready or I/O failure. Never repeat previous values as fresh samples.
- Do not guess ADC calibration or extrapolate out-of-range battery voltage.
- No restricted vendor code is imported. Register facts come from TDK documentation;
  board pins come from matching executable/USB evidence and supporting schematic.
- Preserve the SBUS discrepancy by leaving both candidate receiver pins unused.

## MVP and acceptance

1. Native ESP32 image builds using the exact SDK and partition layout.
2. Host tests exercise wrong identity, transport errors, corrupt configuration,
   signed burst decoding, unit conversion, stale-data exclusion, ADC bounds,
   missing calibration and output-buffer truncation.
3. Compiled application exposes JSON diagnostics and no motor actuation path.
4. Required source/repository checks pass before source publication.
5. Physical boot, gate levels and sensor/voltage accuracy stay unverified until
   exact-device loading and measured readback have their own receipts.

## GTM / release / rollback

Development history (0.1.0): implementation complete for the build-only milestone. The official
ESP-IDF MCP build succeeded with the exact locked SDK. The 149,280-byte application
image passed esptool image validation; the generated partition-table bytes match
the captured layout. ELF review confirms motor inhibition is the first app action.
Portable C fault tests and JSON contract assertions pass. The repository's native
`npm run check` passed all three selected owner checks (evaluators, candidate,
behavior); this is bounded validation, not physical or flight-control proof.
Build inputs, binary hashes and validation receipts are retained under
GameXR/.artifacts/usb-diagnostics-firmware-2026-09-25. The existing repository npm
audit reports a transitive nanoid advisory; this change adds no npm dependency and
does not link npm dependencies into the ESP32 firmware.
Production release: not deployed. That build-only source milestone performed no device write.
The smallest useful outcome is an inspectable bench diagnostics image and honest
fault reporting before stabilization work. Preserve device-specific NVS and full
backup as recovery evidence. Source publication follows agentic-os RELEASE and
stops at provider handoff; physical installation is separately bound to exact files.

## Direct Wi-Fi successor implementation, 2026-09-25

User steering selects phone browser directly on the device AP; the supplied SSID,
password and HTTP URL were confirmed historical. Preserve USB output and motor
inhibition while enabling fresh IMU overlays and an opt-in phone camera. No flight
commands, vendor code, native Apple build, or battery calibration work is added.
Sprint cap: one firmware target, authored modules below 600 lines and chunks below
500 kB; 30-minute implementation plus a bounded 15-minute validation continuation.

ADR: reuse historical AP address/credentials for continuity, read-only GET routes,
WPA2 with two clients, no internet routing, no persisted Wi-Fi/NVS or PHY writes.
The root page is standalone to fit the ESP32; it does not bundle the host dashboard.
Camera uses a trusted HTTPS origin and local preview only. Device private TLS inputs
are ignored build artifacts; source-only builds remain HTTP capable. A short-lived
root is reused from the local gateway, with user-controlled phone trust and removal.
No certificate trust setting is changed automatically.

Acceptance adds malformed/unsafe telemetry rejection, 1.5-second stale clearing,
sequence/session validation, HTTP camera denial, late-grant cleanup, hidden-page
track stop and BFCache resume. Portable core and five browser behavior tests pass.
The page is visible in the local browser with a synthetic-data banner; this does
not establish phone, radio, or TLS-on-device success.

Backup state: original 4 MiB backup SHA-256
`1fdc90ccddc97055b109d88673f60c4a4c62606345e322b0f505f7d2b580ee66`
and immediate pre-replacement backup
`95ef2fc5b07af672e903da6c54e1f195e8e80872559d3b5da0098da957b6c2fb`
were rehashed successfully. The pre-update passive USB capture identifies independent
diagnostics 0.1.0, with motor gates commanded low. No full erase occurred: historical
settings, filesystem and inactive data remain preserved, unused by the new app.

Development: official MCP build, six focused tests and all three selected native
repository checks pass. Image size is 841,520 bytes, SHA-256
`805679b724b884e88734f597bf307438b9f904a14b2ee00deffb23a3b6afb6d0`.
Final build/input receipt and exact-device readback are recorded separately under
`GameXR/.artifacts/direct-wifi-2026-09-25`.
Production release: pending. Source publication inherits old native CI; changing
that shared path is blocked by the existing phone-browser lane's reservation.
Do not bypass the reservation or trigger skipped native builds.

Runtime: an authorized bench-only app update at 0x10000 was written and verified.
The fresh 4 MiB pre-update backup has SHA-256
`a8561220edc744ded95755f8d456b462c86c1042a90889a0a2b1d9030a8bc01b`.
Initial preflight found changed 8 KiB OTA boot metadata; no write occurred until
that region was read afresh and the complete reconstructed backup matched live
flash MD5. All bytes outside the app's erased sectors were verified unchanged.
Historical backup, earlier diagnostics backup, flash receipts and private TLS
inputs remain retained. No erase-all, eFuse changes or trust installation occurred.

Boot capture confirms version 0.2.0 and HTTP 8080/HTTPS 8443 startup. All 135 captured
samples reported valid IMU data and low-held motor outputs. However two USB
disconnects/restarts broke sustained capture; a separate bounded passive raw read
also ended with device-not-configured. No captured application fatal explains this.
Cause is unresolved; do not claim stable USB, radio or phone acceptance. The raw
capture confirms 0.2.0 independently of the image receipt. Battery is now reported
out-of-range and null, as required by the existing conservative ADC contract; full
range calibration remains KIV.

Next owner action: obtain phone AP/page result and whether power/cable was changed,
diagnose repeated USB loss without guessing a cause, then verify HTTPS/camera on the
phone and resolve source CI ownership. Serial readers are closed; no further writes
or resets are scheduled. Local synthetic preview remains available for inspection.

## USB control readiness follow-up, 2026-09-25

The user asked whether the visible cockpit can now control the physical drone over
USB. One 30-second passive test captured 289 consecutive samples, boot version
0.2.0, valid IMU status and low-held motor commands throughout. It made zero serial
writes and no firmware changes. No disconnect or sequence reset occurred in this
bounded check; the cause of earlier intermittent USB loss remains unresolved.
Evidence: `GameXR/.artifacts/usb-control-readiness-2026-09-25-dzaziL/readiness.json`.

The existing loopback diagnostics bridge was restarted and its read-only browser
session opened with a 120-second limit. This supplies live sensor observations.
The cockpit and Drone bench receiver remain simulated; this firmware has no input
command receiver, arming, motor PWM, stabilization or flight connection-loss logic.
Physical flight/motor acceptance remains blocked by those missing capabilities.
The next implementation slice is a bounded USB command/acknowledgment protocol and
dry-run mixer with motor gates still held low, then timeout/disconnect fault tests.
That work is a subsequent milestone, not claimed implemented by this readiness test.
Battery calibration remains KIV. Source publication still has the recorded shared
CI reservation dependency; this observation introduces no release or flight effect.

## USB command bench implementation, 0.3.0

User authorization: run the proposed USB command/acknowledgment test with motors
disabled, followed by failsafe, stabilization and motor-control validation. Reuse
the existing propeller-removal and motor-isolation grant for this non-actuating
bench slice. Thirty-minute cap, one firmware project and its tests, each authored
module below 600 lines. New outputs remain in GameXR/.artifacts/usb-bench-2026-09-25.

PRD: receive bounded serial commands, acknowledge accepted/rejected requests,
expire command authority on silence, and compute virtual motor values from live
gyro observations while actual outputs stay zero. Physical closed-loop flight,
motor rotation/order and powered motor tests cannot be claimed by this slice.
Battery calibration remains KIV. Phone/Wi-Fi endpoints remain read-only.

TAD/ADR: pure C state machine and mixer share the existing gyro unit conversion.
The SDK UART0 RX adapter polls bounded data and driver errors at a nominal 10 ms
cadence; existing IMU telemetry remains 10 Hz. Hardware gate inhibition is still
the first application action, with no hold-release/PWM path. The independent model
has no GPIO dependency. Rate damping uses an explicitly untuned proportional gain,
native sensor axes and an unverified logical X mixer; it is not an attitude
estimator or flight controller. Candidate values are integers 0..200 permille;
actual motor outputs are always reported [0,0,0,0].

Protocol: ASCII LF-terminated `GXR1 HELLO`, `GXR1 STOP`, and
`GXR1 SET <session> <sequence> <throttle> <roll> <pitch> <yaw>`.
Throttle is 0..200 permille; target rates are -1000..1000 milliradians/second.
HELLO creates a fresh session and zeroes state. SET requires increasing positive
sequence, a current session, a fresh valid IMU and at least 50 ms since the prior
command. Commands expire at 250 ms. STOP always clears state. Invalid framing,
partial lines at 100 ms, driver errors, stale/invalid IMU, sequence/session/range
errors or excessive rate revoke the session and zero the virtual output. Fresh
HELLO is required after a fault. Replies use gamexr.usb-bench/v1 and are capped at
20 Hz. Framing is 95 printable bytes plus LF. The local session ID provides replay
separation, not cryptographic authentication or a flight-suitable transport.

MVP checks: portable model tests cover boundary expiry, replay/reordering, rate,
range, malformed/oversize/partial input, non-finite sensor values, stale IMU,
zero-throttle, response truncation, mixer signs/saturation and 100,000 hostile bytes
under ASan/UBSan. All repository-selected checks pass. Official ESP-IDF MCP builds
0.3.0 (858,224 bytes), SHA-256
`3bd53e1a7f7658399284752f5f47e67fc53bb59c3caadf328b32d403ab244cdb`.
ELF inspection again confirms inhibition is the first app action. Exact app-only
loading, fresh full backup, live acknowledgments and 20 silence-expiry trials have
separate device receipts. Production/flight remains unapproved and unverified.

GTM: the immediate usable result is a reproducible hardware command test without
spinning motors. The next physical boundary needs a verified mapping between sensor
axes, logical mixer slots, motor positions and rotation directions, measured gate
levels and a deliberate transition from isolated to controlled motor power. Do not
equate virtual calculations with a passed stabilization or motor-thrust test.

Runtime result: verified app-only write and boot on the selected device. The fresh
full-flash backup SHA-256 is
`afed522e906142392225d457d83db35b508e2bf13795536093c6d5d2ea51f363`.
The live harness passed nine checks: hello/SET acknowledgment, duplicate sequence,
out-of-order sequence, stale session, throttle range, axis range, excessive burst,
malformed and oversized command rejection. It sent 20 command writes before USB
failed after 3.581 seconds. All observed acknowledgments reported actual outputs
disabled and motor values zero. The partial-frame case and all subsequent cases,
including the 20 silence-expiry trials, remain pending on-device; host model tests
for those conditions pass and do not replace live proof.

macOS kernel evidence records hardware connection lost for 1a86:7523 and immediate
re-enumeration; the AppleUSBCHCOM driver reports zero crashes. This establishes a
USB disconnect, not its physical cause. Record whether the operator changed power
or cable, stabilize the connection, then resume the retained harness. No further
device writes/resets/readers run automatically. The firmware's GPIO holds remain
in place, and this task adds no motor authority. Source publication still depends
on the shared CI ownership recorded above. Physical stabilization/motor acceptance
cannot proceed on this incomplete USB validation result.

Operator follow-up: cable and power stayed untouched during the failed live run.
IORegistry places the bridge behind an Apple USB2.0 Hub (05ac:1011), with the serial
bridge 1a86:7523 below it. A direct known-good data connection, or a changed cable/
hub port if direct connection is unavailable, is the next physical diagnostic.
Do not label the hub defective: the actual cause remains undetermined. Reobserve
the serial device and backed-up ESP32 identity after any topology change before
resuming device work. No firmware flash is needed merely to change the cable path.

## USB connection recheck, 2026-09-25

PRD/authority: the user requested a recheck of the hardware USB disconnect. Reuse
the existing isolated-motor bench grant. Scope is device identity and the retained
live command harness; no firmware write, new motor authority or production effect.
The run is capped at 90 seconds/490,000 bytes; documentation remains in the admitted
firmware lane and evidence in GameXR/.artifacts/usb-bench-2026-09-25/live-02.

TAD/ADR: the host now enumerates `/dev/cu.usbserial-1110`, VID:PID `1a86:7523`,
location `1-1.1`, instead of the old `-110` path at `0-1.1`. Rebind by observed port
and ROM-read MAC `08:b6:1f:9a:ea:50`, not USB model ID alone. Official esptool
identified the same ESP32-D0WDQ6 revision 1.1 and reset to the existing app without
writing flash. The USB topology still contains the Apple USB2.0 Hub; this does not
prove which physical cable/port changed or identify the original failure cause.

MVP/runtime: the unchanged live harness verified startup 0.3.0/uart_code 0 and
passed all 14 checks in 17.009 seconds, with 91 command writes and 69,082 captured
bytes. This includes partial-frame expiry, STOP, all 20 command-silence expiries
and stale-session rejection, the logical mixer/zero throttle, and host close/reopen.
Host-observed expiry delays were 247.10..268.83 ms after accepted acknowledgment;
do not reinterpret them as motor-cutoff timings. Every observed acknowledgment
reported outputs disabled and actual motor values [0,0,0,0]. No disconnect occurred
during the run. The final serial port was present and unowned; no reader remains.
This successful run supersedes the pending live cases above, while preserving the
first failed run as historical evidence. It does not prove long-term reliability.

GTM/next owner action: USB command/fault validation is now reproducible on the
identified board. Physical flight still needs verified sensor axes, motor mapping
and direction, measured gate inhibition, and controlled stabilization/motor tests.
The cockpit remains a simulation; this recheck does not connect it to actuators.
Battery calibration stays KIV. Source publication still has the shared CI ownership
dependency; no source publication or firmware deployment occurred in this recheck.

## Recommended USB reliability follow-up, 2026-09-25

Recommendation only: the latest 17-second pass is insufficient to close the earlier
intermittent hardware disconnect. No device action is performed by this planning
update. Retain existing firmware, propeller removal and motor isolation.

Next bounded diagnostic: one five-minute passive telemetry capture on the observed
port with exclusive ownership, recording sequence/uptime/boot messages alongside
macOS USB events. Cap aggregate capture at 4 MiB, each chunk below 490,000 bytes,
stop on first disconnect or byte/time limit, and close the port. After a complete
clean capture, run the existing 14-check command harness once. Six minutes total
is the suggested diagnostic budget, excluding operator hardware changes. Store
new evidence under GameXR/.artifacts; compare against retained live-01/live-02.

If loss recurs, correlate bridge disappearance with kernel events and distinguish
it from an ESP restart while USB remains enumerated. Change one physical variable
at a time: bypass the hub if an existing suitable direct data cable is available,
otherwise replace the data cable, then try another Mac port. Re-identify after
changes. Inspect board power/connector integrity only if the simpler comparisons
fail; do not flash, erase or replace drivers without supporting evidence.

Espressif lists hardware/driver/port ownership as causes of serial exceptions and
recommends shortening the USB path when investigating serial instability:
https://docs.espressif.com/projects/esptool/en/latest/esp32/troubleshooting.html
This supports the diagnostic order, not attribution of this incident.

A clean longer run supports continuing non-actuating development, while the old
root cause remains unreproduced/unconfirmed. Physical stabilization and flight
acceptance still require their separate measurements and tests. Battery remains
KIV; source publication retains its existing CI ownership dependency.

## Five-minute USB stability observation, 2026-09-25

PRD/authority: user requested the recommended five-minute passive stability test.
Existing propeller removal/motor isolation was reused. One exclusive USB reader,
300-second observation, 315-second watchdog, 4 MiB total capture cap and chunks
below 490,000 bytes. No serial commands, deliberate reset, flash or motor operation.
The OS/driver can reset on opening; the one initial boot is explicitly retained.

TAD/ADR: reuse serial_port.selected_port from the admitted observer checkout. The
first strict parser run stopped after 4.172 seconds with malformed sample 25 and no
USB hardware loss. Preserve it at GameXR/.artifacts/usb-stability-2026-09-25-WUdcMw.
The observation runner then counted malformed lines and gaps through the bounded
interval while keeping data-integrity failures explicit; no firmware was changed.
The prior ROM identity binding was reused with the same observed VID/PID/location.

MVP/runtime: full observation completed for 300.029 seconds (301.536 seconds total),
with 2,999 valid samples across sequence 0..3000. Samples 120 and 1179 were malformed,
leaving two valid-sequence gaps. No unexpected reboot, uptime regression, IMU error
or kernel hardware connection-loss event was observed. Valid samples consistently
reported motor gates low-held; physical gate voltage remains unmeasured. Source
firmware and command harness were unchanged. Full capture is 1,206,898 bytes.
Chunk/producer hashes, sample/error counts and sequence gaps were independently
recomputed. The normal 63-byte incomplete final line at the time boundary is recorded
and excluded from malformed-frame counts. The serial port remained present and
unowned after closure; no collector or automatic retry remains active.

Result: USB presence survived this interval, but data integrity FAILED. The promised
conditional command-suite rerun was skipped because a clean capture was required.
The prior 14-check pass remains historical evidence. Capture, receipt, verification
and kernel logs: GameXR/.artifacts/usb-stability-2026-09-25-KfEBgD. The missing bytes
do not identify whether firmware TX, bridge, cable/hub or host driver is responsible.

GTM/next owner action: compare one physical connection variable, starting with a
known-good direct USB data path if available, then repeat this bounded observation.
Resolve telemetry corruption before expanding control acceptance; keep physical
outputs inhibited. Battery remains KIV. This task made no firmware deployment or
source publication; the earlier shared-CI ownership dependency remains unchanged.

## Phone-browser acceptance continuation, 2026-09-25

Implemented within the existing firmware lane: two browser regression cases replay
the exact damaged sample bytes from the passive capture inside the Wi-Fi envelope.
They prove displayed readings clear on malformed input, fresh samples recover,
automatic polling stops after five failures, and an explicit retry resumes reading.
The replay does not assert that Wi-Fi produced the USB corruption. All nine focused
firmware/browser tests passed, including portable model sanitizer checks and camera
lifecycle/security checks. There is no product runtime change or new dependency.

The Mac route to 192.168.4.1 uses its existing 192.168.0.1 default gateway; it has not
joined the aircraft AP. No network settings were changed and no live Wi-Fi success
is claimed. The phone's AP/page result is requested and pending. Once the page is
reachable, verify advancing sequence/live IMU, disconnection clearing, and local
camera preview over trusted HTTPS. HTTP telemetry alone does not validate camera.
Phone acceptance is an operator dependency, with recheck on the reported result.

KIV does not bypass malformed/stale-data rejection or authorize physical flight.
No USB device operation, firmware build/flash, motor command or certificate trust
change occurred in this continuation. Source publication retains its shared-CI
ownership dependency. Evidence and repository-check results are retained under
GameXR/.artifacts/drone-next-stage-2026-09-25-DcrDY6.

## Dashboard access clarification, 2026-09-25

The existing GameXR dashboard responds HTTP 200 at
http://127.0.0.1:4194/gamexr/ and its process listens only on 127.0.0.1:4194.
It is reachable on the Mac; a phone's loopback URL does not address that Mac.
The Mac currently has LAN address 192.168.0.105, but no listener on that address
was enabled by this check. Opening the full dashboard on a phone requires the
existing LAN gateway setup and a shared network, separate from joining the drone
AP for its embedded page at http://192.168.4.1:8080/. Camera acceptance still
requires trusted HTTPS. No USB operations, firmware changes, network changes or
new exposure occurred. USB/battery KIV and physical output inhibition persist.

## Full GameXR phone gateway launch, 2026-09-25

User requested running the full GameXR interface on a phone to control the drone,
then asked whether installing the certificate permits Mac-free flight. Answer:
the current firmware has no physical arming/PWM/flight controller. Certificate
trust enables HTTPS/camera; it does not supply control capability. This gateway
uses phone → Mac → USB for read-only observations. Direct phone → ESP32 Wi-Fi
already supports diagnostics, but wireless physical flight is not implemented.

Runtime: launched the unchanged phone-browser candidate at commit
93133aa75cfe403b80b119ef72508e32e52efe59 on the current private interface
192.168.0.105:4196 over HTTPS. Reused the existing matching certificate/private key.
A separate allowlisted HTTP setup surface on port 4195 serves only instructions
and the public CA certificate. The existing gateway requires a one-use pairing
token for telemetry, leaves serial closed until an authenticated Start capture,
and limits each observation to 120 seconds. No motor command endpoint was added.
Ten-minute setup budget, two listeners, artifact files below 500 kB; both listeners
automatically stop one hour after launch. No public routing/firewall changes.

Checks: TLS chain and IP verified, app and six asset routes return 200, unpaired
session returns 401, wrong Host returns 403, certificate hash matches, and a private
key path on the setup server returns 404. Browser inspection rendered the setup
steps. This verifies the Mac service, not actual iPhone connectivity/camera. The user
selected iPhone/Safari and reported the certificate is not trusted. Manual profile
installation and trust on the phone remain the next operator step. No trust setting
was changed automatically; no firmware write or serial capture was performed.

Receipts, served-build hashes, startup/stop times and private pairing link are in
GameXR/.artifacts/phone-gateway-run-2026-09-25-h8DjHB. The old local page on port
4194 remains available. USB reliability and battery calibration retain KIV status.
Powered flight acceptance is not bypassed: axes/motor mapping, gate measurements,
flight control and failsafe behavior remain unresolved physical milestones.
No source publication or source-lane mutation outside the admitted plan occurred.

## Direct phone Wi-Fi clarification, 2026-09-25

Verified against the flashed 0.3.0 source snapshot and retained boot telemetry:
SSID XW_Drone_WiFi, password 12345678, HTTP port 8080 and HTTPS port 8443. The
phone can use this direct AP path independently of the Mac gateway, provided the
board is powered. The HTTP endpoint needs no certificate installation. It serves
the embedded diagnostics page; it does not serve the full Mac GameXR bundle or
restore the historical vendor flight controller. Actuation remains unavailable.

The embedded TLS certificate covers 192.168.4.1, verifies under the same GameXR
local CA offered by the Mac setup page, and expires 2026-10-01 10:16:43 UTC. After
manual CA trust, https://192.168.4.1:8443/ is the configured camera-capable origin.
Actual phone AP/page/camera success remains unverified. This clarification used
retained evidence only: no USB test, reset, firmware or network change. KIV statuses
and physical motor inhibition remain unchanged.

## Direct Wi-Fi cockpit-control next milestone, 2026-09-25

Operator now reports the GameXR CA trusted in iPhone/Safari. Record this as an
operator-completed setup step; it is not yet an observed phone connection or camera
acceptance. Do not ask to repeat certificate installation.

Current gap confirmed from source: ESP32 serves only GET diagnostics/static-page
routes; the full GameXR Drone panel targets a simulated receiver through the Mac
bridge. The USB bench accepts only virtual setpoints, and firmware retains GPIO
holds with no physical arming/PWM/flight-control path. There is no existing UI
switch that turns the installed diagnostics build into a flight controller.

Recommended next implementation is a direct-Wi-Fi, motor-inhibited cockpit link:
serve the full cockpit from the ESP32; add an authenticated wireless command and
acknowledgment profile; connect the cockpit to that real-device profile; show accepted
setpoints, live IMU, virtual mixer outputs and explicit output inhibition. Define
command units instead of forwarding the incompatible simulated-receiver protocol.
Test STOP, invalid/stale/replayed commands, Safari hiding/closing and Wi-Fi loss
with the watchdog enforced on the ESP32. No automatic resume after a lost session.

Packaging preflight: current GameXR build totals 940,650 bytes across 24 files. The
existing SPIFFS partition is 0x160000 bytes at 0x290000. This establishes a candidate
packaging budget, not a proven filesystem fit or permission to overwrite preserved
historical contents. Build the exact filesystem image and preserve/verify recovery
bytes before any separately reviewed device update. No filesystem write occurred.

Subsequent physical milestone: onboard attitude/stabilization and validated sensor
axes/motor mapping, arming/disarming, PWM and output-cutoff behavior. Powered motor
acceptance precedes a restrained hover/flight acceptance decision. USB investigation
and battery calibration remain KIV; the active Wi-Fi command path must gain its own
reliability and failsafe proof before physical use. Certificate trust supplies neither
these functions nor flight authorization. This turn records the next implementation
scope only; no firmware, control, USB, network or certificate trust change was made.

## 0.4 direct cockpit implementation, 2026-09-25

PRD: user authorized implementation, minification, Motion default, and reuse of
historical input sensitivity. 45-minute pass; admitted firmware/test/plan scope;
modules under 600 lines, generated chunks under 500kB. USB integrity investigation
and full-range battery calibration stay KIV. No physical actuation is introduced.

TAD/ADR: gzip-embed the pinned full cockpit into app0 instead of overwriting SPIFFS.
The initial 26-asset build is 978,940 bytes raw / 265,647 gzip (300kB packed cap).
App0 must remain below 0x140000 bytes. Reuse the published 93133aa phone-browser
source and its motion/camera owners. Add a separate live bench panel: HTTPS-only
POST, exact Host/Origin, per-build private pairing key, bounded ASCII commands,
independent 250ms device lease, serialized RAM model with no socket IO under lock.
USB and Wi-Fi models remain separate; both only calculate virtual motor values.

MVP: Motion selected by default; operator gesture grants Safari permission; explicit
bench enable begins a session at zero throttle. Hide/blur/lost telemetry or motion,
invalid ACK and STOP revoke local authority; board silence timeout independently
zeros virtual outputs. No automatic reconnect/resume. Full simulated stage remains
separate. Camera stays on the phone. Physical motor pins remain low and held.

Historical numerical facts: 40% expo, 6% axis/throttle dead zone, roll/pitch scale
0.85, yaw 0.68, throttle scale 1. Source is the vendor bundle at 89624582, whose
application matches the original backup; these are source defaults, not claimed
current NVS tuning. Preserve PID/rate/tilt values as reference, not active gains.
New normalized-to-bench mapping caps rates at 1 rad/s and virtual throttle at 20%;
30-degree phone tilt span is a new input choice, not proof of historical phone
motion behavior or equivalent flight response. No restricted implementation copied.

GTM: direct offline iPhone cockpit bench validation, no flight-ready claim. Build,
host tests, actual device update and actual phone acceptance are distinct receipts.
Rollback: verified pre-update 4MiB snapshot plus exact predecessor app, app-only
write/readback at 0x10000; protect all other partitions. Results appended below.

### Implementation evidence and remaining acceptance

0.4.0 was flashed app-only: SHA256
13a022d98ecae7f28b85d24b8cc905077b797b162a1e509af0ead5e32a4b68a0,
1,125,776 bytes. All other flash ranges passed comparison. Fresh preflash backup
SHA256 2a6907b4cf4680622adde557e9e4d969bd397d2c788eab6537bbc0ec2d7eddae.
The post-reset USB capture failed; a bounded passive capture observed 0.4.0 and
MPU-6500 identity before the same disconnect. USB investigation remains KIV.

Operator confirms full cockpit loads over direct Wi-Fi. Supplied actual API frame
was valid (session 3667260253, seq 2880, sample age 101ms), but panel showed no IMU.
This distinguishes confirmed working sensor/API from unaccepted cockpit telemetry.
The 0.4.1 candidate adds cold-connection allowance, conservative round-trip age,
500ms UI freshness cutoff, BFCache return handling and hashed extension filenames.
No SET deadline (180ms), device lease (250ms), or output inhibition was weakened.

Final app: 1,126,080 bytes, SHA256
d9c27715a5f9079882fb6a3f78588b055ad84072926711210f36bcf76b4d706f.
26 assets: 974,973 bytes original, 264,403 gzip (72.9% smaller). SDK build and UI
typecheck passed; 16 focused tests including C sanitizer checks and captured phone
response pass within the three green agentic-os owner checks. Runtime binaries
exceed the text-generation chunk cap by design and stay in canonical artifacts.

The first final upload failed before writing (macOS Device not configured).
Requested a single cable reconnection to unblock installation, not a new USB
stability investigation. No source publication, integration, production release,
physical actuation or flight acceptance is claimed. Existing native-build CI/
shared reservation issue still prevents a compliant source publication here.
Evidence: GameXR/.artifacts/wifi-cockpit-2026-09-25 and corresponding -final.
Preserve all backup and unsuccessful-attempt receipts. Remaining owner action:
install exact final candidate, recheck phone IMU and ACK/STOP/background/Wi-Fi loss.

Historical data successor: 78 captured numerical parameters are retained in
firmware/esp32-usb-diagnostics/historical-flight-reference.json; five invalid
receiver mappings remain explicit null. Source-default input sensitivity is reused
independently; observed old PID/calibration values are reference-only. Hardware
axes, tuned stabilization, motor mapping and powered acceptance remain later work.

### Resume: final application update verified

User continued the interrupted task. Fresh USB identity/location was observed and
the port was unowned. Attempt 2 stopped before device I/O because its generated
recovery-receipt path was incorrect; attempt 3 corrected that path and completed
app-only write and readback verification. The original failed receipts remain.
Compiled inputs exactly match the build snapshot; a separate hashed record binds
the documentation-only changes made after the build. No rebuild was substituted.

Installed 0.4.1 SHA256 d9c27715a5f9079882fb6a3f78588b055ad84072926711210f36bcf76b4d706f.
Fresh 4MiB preflash backup SHA256
c5ffb382f3cf96fca2c4ba59781dfd2e17e74c4c6643f4d923312507a59a7c20.
Protected bytes [0,0x10000) and [0x123000,0x400000) verified unchanged; boot reset
requested, serial handle closed. Exact receipt is in the -final artifact directory
as flash-receipt-attempt3.json. Mac preview restored on 4199 with the final assets,
explicitly synthetic telemetry, Motion default and no device command authority.

Requested actual iPhone verification with the private pairing link: increasing IMU
and ACK numbers, followed by STOP to zero virtual outputs. Until that response,
phone acceptance remains pending. Physical motor gates remain inhibited.

### Main cockpit controls, 0.4.2

PRD: user selected the main joystick, throttle/BRAKE, Enable Motion and Start for
Wi-Fi drone control. All four now own the motor-disabled board bench session;
the duplicate panel controls are removed. Motion remains the default preference.
TAD/ADR: a pinned-shell DOM contract claims these events in capture phase before
simulation handlers, uses the original Motion module and historical input curve,
and never converts simulation telemetry into drone commands. Explicit input-mode
changes stop and zero inputs. Start performs authenticated HELLO, then bounded
SET/ACK; Pause/BRAKE/reset/cancel/focus loss stop. Yaw stays zero. No actuation path.
MVP/GTM: one familiar mobile cockpit, local/offline, no additional dependencies or
services. New input/DOM adapter modules stay below 200 lines each; total compressed
cockpit budget remains 300kB. Private keys and all build/flash/preview receipts are
in GameXR/.artifacts/wifi-main-controls-2026-09-25. Runtime images retain the
existing binary-size exception and 0x140000 app partition ceiling.
Validation: real browser synthetic receiver exercised Start, throttle, joystick,
Brake, zero-input restart, Pause and Motion activation. Found and fixed native
fetch receiver binding. Phone sensor signs/timing and direct board ACK acceptance
remain pending; preview success is not hardware flight acceptance. USB reliability
and full-range battery calibration remain KIV. The existing shared CI reservation
still blocks source publication independently of local bench development updates.

Phone viewport follow-up 0.4.3: status and connection button avoid the touch
controls; telemetry refresh reasserts bench HUD fields after simulator resize.
The final candidate is isolated in wifi-main-controls-2026-09-25-final.

### Dedicated Wi-Fi Drone mode, 0.4.4
PRD: remove gaming visuals and loading from drone operation. TAD/ADR: a separate
drone entry owns the existing controls, Motion and Camera; game renderer/scene
imports and cache preloads are excluded. Game Mode is explicit navigation with
STOP and no command-key transfer. MVP/GTM: 19.8kB compressed drone entry/cache,
zero new dependencies; gaming stays available separately on the board. Evidence:
GameXR/.artifacts/wifi-drone-mode-2026-09-25 (build, checks, preview, flash/handoff).
Recovery: 0.4.4 app/full flash verified; protected ranges and backup preserved.
Boot confirms 0.4.4, 139 healthy IMU samples, HTTPS 8443 and inhibited outputs.
Phone/USB repeat checked: residual 0.003158 rad/s < diagnostic 0.01; warm-up differs. Gyro inactive. Evidence: GameXR/.artifacts/wifi-ota-phone-2026-09-26/repeatability-02. Physical axes/OTA rollback pending.
