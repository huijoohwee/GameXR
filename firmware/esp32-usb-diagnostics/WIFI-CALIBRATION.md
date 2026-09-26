# Wi-Fi stationary IMU capture — introduced in 0.4.5, reviewed after 0.4.6 recovery

Continuity: GAMEXR-WIFI-IMU-CAPTURE-001@0.1.2.

## PRD / MVP

Capture a fresh stationary gyro measurement from iPhone Safari on the drone AP,
without a USB telemetry reader or a Mac gateway. The existing 0.4.4 firmware has
only a latest-sample endpoint; this feature requires firmware 0.4.5 or newer. Installed 0.4.6 includes it.
It does not activate calibration, transform sensor axes, enable motors, tune a
flight controller, or resolve battery calibration. USB investigation remains KIV.

After the firmware update:

1. Join `XW_Drone_WiFi` and open the trusted
   `https://192.168.4.1:8443/gamexr/` dashboard. Wait for live IMU.
2. Open **Connection** and scroll to **Stationary IMU capture**.
3. Leave the board still with the previously confirmed motor isolation maintained.
   Check **Board stationary · motor power isolated**, then **Capture 20 seconds**.
4. Keep Safari visible. A successful run shows **200/200**, with gyro fit and
   independent validation passed. Tap **Save capture JSON** and retain that file.
5. Review the exported measurement against the historical reference before any
   separate calibration-activation change. No activation control exists here.

Start stops the local bench session. Bench Start is rejected while capturing.
Cancel, closing the Connection panel, switching apps, or leaving the page ends
the run. Partial or rejected runs can also be saved; they contain no valid fit.
No automatic restart or merging of interrupted windows is permitted.

## TAD / ADR

The sampling owner publishes to a 32-row RAM ring before USB console output.
It uses about 21 kB static RAM and at most one roughly 5.3 kB batch allocation per
HTTP handler. The ring lock only covers bounded memory copies, never HTTP I/O.
No sensor configuration, sample rate, motor gate, NVS, or command protocol changes.

`GET /api/imu-window` establishes a boot-session and latest-sample cursor. That
baseline is discarded. `GET /api/imu-window?session=N&after=S` returns up to eight
consecutive subsequent samples with schema `gamexr.imu-window/v1`, `session`,
`age_ms`, `actuation_available:false`, and `samples`. Empty fresh batches mean wait.
The existing exact Host/CSP/no-CORS/no-store policy applies. This read-only route
has no pairing secret or command body. Wrong sessions/expired cursors return 409;
missing or stale data return 503. Samples are copied atomically before sending.

Browser requests run serially with a 1.5-second request limit, 6,000-byte streamed
response cap, 35-second overall cap and 200-sample maximum. Freshness includes the
entire request duration. New boot sessions, gaps, reordered frames, unsafe motor
claims, unhealthy IMU and invalid protocol fields reject the run. No samples from
before Start enter the fit. A restart requires new stationary confirmation.

Reuse the pinned FOSS `parseFrame` and `fitGyro` owners from the phone-browser
candidate `93133aa75cfe403b80b119ef72508e32e52efe59`; copy no vendor implementation.
First 100 samples fit gyro bias, next 100 independently validate it. Existing
continuity, timing, movement, gravity and held-out residual thresholds are unchanged.
This is a sensor-frame measurement; board/body-axis mapping and full six-face
accelerometer calibration remain separate. Historical values stay reference-only.

The panel initializes when Connection opens. No new dependency is installed.
The built drone entry/cache adds 3,926 gzip bytes (23,746 total); all optional Game
Mode assets bring the embedded total to 271,826 bytes, below the 300 kB ceiling.
No game renderer, scene or model enters the drone entry or precache.

## Development / production / runtime / rollback

Development validation: 24 focused tests, UI type check and all three repository
selected owner checks pass. Sanitized C tests cover wrap, overflow, stale windows,
cursor bounds and gaps. Browser preview completed 200 synthetic samples with a
100/100 fit/validation split, saved the JSON file and cancelled a second run at
53 samples. The 390×844 layout was inspected. These are synthetic/host checks.

Official Espressif MCP builds 0.4.5; esptool validates the image. Exact output
hashes, source snapshot and checks live in
`GameXR/.artifacts/wifi-calibration-2026-09-25`.

Production source release remains blocked by inherited native CI/shared reservation;
no source integration or production flight acceptance is claimed. The 0.4.6 successor
was installed with exact bootstrap verification. The operator subsequently confirmed
phone OTA to 0.4.7 and manual recovery to 0.4.6; see WIFI-OTA.md for those receipts.
Automatic rollback/interrupted-transfer acceptance remains outstanding.

Retain the verified 0.4.4 app and full backup under
`GameXR/.artifacts/wifi-drone-mode-2026-09-25-final` for recovery. Future installation
must bind the exact app, current device/backup and protected flash ranges under
the existing app-only deployment workflow for 0.4.5. Candidate 0.4.6 additionally
requires the reviewed bootloader bootstrap described in WIFI-OTA.md. No hardware operation occurs in this
implementation turn. GTM outcome: a USB-independent measurement path ready for
device validation; no powered flight or historical flight-response parity claim.

## Physical phone capture review — 2026-09-26

The user supplied `wifi-ota-phone-2026-09-26/gamexr-wifi-imu.json` after reporting
recovery to 0.4.6. File SHA-256:
`3dbcf8c0f17c08f7731f5fb04d7cb9e5c75d847b50d50494358eff644fbc3a97`.
It contains 200 healthy sensor-frame samples, sequence 2134–2333, over 20.165 seconds.
The existing hash-pinned FOSS parser and fitter accepted all frames and reproduced
the exported 100-sample fit / 100-sample holdout result exactly. Independent Python
mean/deviation calculations also passed. Every sample reports motor gates low held.

Fresh gyro bias X/Y/Z: [-0.05161913, 0.00537451, 0.02013664] rad/s. Held-out mean
residual norm: 0.000163323 rad/s using the fresh fit, versus 0.002931180 rad/s using
the original USB-reported bias [-0.052241, 0.006233, 0.017414]. Both are below the
existing 0.01 rad/s admission threshold. This is a mean-residual comparison within
one session, not a total-noise or temperature-range accuracy claim.

Raw gravity magnitude error is 0.376218 m/s²; historical correction gives 0.084293
m/s² with the previously documented 15 ppm conversion assumption. A single pose
cannot validate all accelerometer offsets/scales or physical axis mapping. The
export contains no firmware identity or per-request timing; live provenance and
original network deadlines cannot be independently established from the file.

PRD/MVP: review the first supplied physical Wi-Fi capture against the USB reference.
TAD/ADR: retain the raw file and reuse pinned validators; save an inactive sensor-frame
gyro candidate without device writes. GTM: phone-based measurement works through the
exported evidence path, without a USB reader or paid service. Evidence, numeric
comparison, inactive candidate and independent check: `wifi-ota-phone-2026-09-26/imu-review`.
Repeatability was subsequently checked as below. Label physical axes and obtain
independent six-pose evidence before body-frame/accelerometer activation. Calibration
is unapplied, motor outputs remain disabled and battery calibration stays KIV.

## Authorized repeatability run — 2026-09-26

The user requested another stationary capture. A bounded HTTPS request timed out;
the Mac remains on its home LAN, routing 192.168.4.1 through 192.168.0.1. No Wi-Fi
change was attempted. A passive USB capture reused the exact existing exclusive
serial owner at `/dev/cu.usbserial-110`, bridge 1a86:7523, direct location 1-1.
The first helper stopped at zero samples because it rejected a valid startup
network message. This was a capture-helper error, not evidence of USB corruption.
Its receipt and producer remain unchanged. A corrected successor admits only the
documented network/ready records before sampling and preserves all fault/gap checks.

The successor obtained 200 consecutive samples, sequence 0–199, over 19.916 seconds,
at 99–108 ms spacing. Exact pinned parser/fitter and independent Python calculations
passed. Fresh bias X/Y/Z: [-0.05138993, 0.00383971, 0.01751997] rad/s. Its held-out
residual norm is 0.000120283 rad/s. Applying the unchanged first Wi-Fi bias to the
second holdout gives 0.003158279 rad/s, below the reused diagnostic 0.01 rad/s bound.
Bias change vector norm is 0.003042220 rad/s; this bound is not a flight tolerance.

A 0.4.6 boot record was observed on USB open; no explicit reset sequence or command
was issued. This window began at 708 ms uptime versus 216494 ms for the phone file.
Warm-up conditions differ and temperature was not measured, so neither the cause
of the shift nor full-temperature repeatability is established. A matched warm-up
comparison is needed before treating the bias as stable across normal operation.
No additional hardware run was performed after these results; Wi-Fi was not retested.

PRD/MVP: compare a fresh, independently acquired window against the unchanged first
candidate. TAD/ADR: use the available passive transport, exact source hashes and a
35-second / 180kB / 200-sample cap; retain failed evidence and distinguish transport
from calibration validity. GTM: obtain useful local sensor evidence without new
dependencies or service cost. Evidence: `wifi-ota-phone-2026-09-26/repeatability-01`
and `repeatability-02`, with raw bytes, timings, producer hashes and comparison.
The serial port is closed and unowned. First gyro candidate remains inactive;
no serial write, flash write or motor command occurred. Physical-axis/six-face
validation, automatic OTA rollback tests and battery-calibration KIV remain separate.
