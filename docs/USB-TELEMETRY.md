# USB diagnostics dashboard

The **Diagnostics** panel observes `gamexr.usb-diagnostics/v1` firmware (the
separate firmware candidate in PR #27). It shows acceleration, angular rate,
gravity-derived tilt, link health and an explicitly unverified battery estimate.
It provides no motor controls, arming or firmware writes. The existing **Drone**
panel remains a separate simulated bench.

## Run against the installed diagnostics firmware

Use Node 24+, Python 3.10+, `lsof` and `pyserial==3.5`. Keep the previously verified
physical setup: propellers removed and motors unable to receive power with USB
connected. Opening a serial device can reset the ESP32 through driver DTR/RTS
behavior even though the reader sets both lines inactive before opening.

```sh
npm run build
npm run drone:diagnostics -- --serial=/dev/cu.usbserial-110 \
  --usb-id=1a86:7523 --python=/absolute/path/to/python \
  --physical-ready=yes --seconds=120
```

Open `http://127.0.0.1:4194/gamexr/?diagnostics=1` and choose **Start capture**.
The checkbox-like CLI acknowledgment records the existing physical setup; it
cannot verify it. The passive reader sends **zero serial bytes**. USB VID/PID
selects the bridge model, not an authenticated PCB identity. Do not run esptool,
the legacy console observer or a second serial monitor concurrently.

The bridge binds only IPv4 loopback and requires exact Host and WebSocket Origin.
The only accepted browser requests are start/stop observation. A shared per-port
lock, `lsof` ownership check and exclusive serial handle prevent cooperative
contention. Each capture is bounded to 10–600 seconds, 2 MB input and 1,024 bytes
per line. Silence for five seconds or a disconnect closes the handle before up
to two retries. Stop, the last browser disconnect, bridge shutdown and the
capture deadline release the port. A stopped capture requires an explicit start.

Host monotonic time controls freshness; samples at least 1.5 seconds old disappear.
Malformed frames clear the current reading; duplicate/out-of-order sequences do
not refresh it. Gaps are counted. Reboot, disconnect and reconnect discard browser
calibration. Browser reconnection attempts are bounded to three, without starting
a new serial session automatically. An active Python capture may still reconnect
within its original time/attempt limits.

**Export session** downloads at most 800 recent samples plus provenance and
calibration (under 500 kB). Move retained exports to canonical `GameXR/.artifacts`.
Exports are local; nothing is uploaded. Port opening may reset the device but
the dashboard does not erase, flash or change firmware configuration.

## Calibration and tilt

Keep the board stationary and select the confirmation in **IMU calibration**.
**Measure gyro bias** collects 200 consecutive samples: the first 100 fit the bias,
and the next 100 independently validate it. Missing/stale/error samples cancel
the measurement. Required limits: gyro standard deviation ≤0.02 rad/s,
acceleration standard deviation ≤0.12 m/s², gravity magnitude 8.5–11.1 m/s² and
gyro mean magnitude ≤0.25 rad/s. Held-out residual must be ≤0.01 rad/s, with
held-out gyro standard deviation ≤0.01 rad/s. Movement rejection means retry
after the board settles; it does not establish a sensor defect.

To establish board axes, choose +X forward, +Y left and +Z up. Hold each of the
six labeled axes vertically upward and capture its 50 samples. The six means
fit a 3×3 accelerometer correction and offset. Geometry, scale, handedness and
opposite-face consistency checks reject implausible fits. A **new +Z-up** capture
must agree within 0.3 m/s² before the correction becomes active. Unit tests use
synthetic known poses; they do not verify this PCB's physical orientation.

Corrections apply only in the current browser session, never to firmware/NVS.
Gyro bias remains in sensor coordinates; the six-face transform applies to
acceleration. Tilt is a gravity-only roll/pitch preview, unreliable under motion
and without yaw. It is not a stabilization estimator or flight controller.
Battery calibration remains **KIV**: no full-range accuracy, state of charge,
health, low-voltage protection or flight readiness is inferred.

## Replay and regression checks

```sh
npm run drone:diagnostics -- --replay=/absolute/path/to/serial-raw.bin
npm run check
npm run test:diagnostics-browser
npm run test:drone-browser
```

Replay accepts ≤499,999-byte newline captures, ignores non-JSON boot text and
keeps `source: replay` / **RECORDED REPLAY** visible. It cannot run live calibration.
The mobile browser regression uses generated synthetic samples, no USB device.
Unit checks cover malformed data, freshness, reboot/reconnect, held-out calibration,
six-face math, observation-only requests and passive-reader handle cleanup.

## Legacy vendor console observer

The remainder documents the earlier vendor console profile. **Do not run this
command-based adapter against the installed streaming diagnostics firmware.**
Its historical source/pin uncertainty below refers to that initial investigation,
not the later matched source and schematic work.

GameXR includes a headless, observation-only adapter for the console profile seen
on the inspected ESP32 firmware. It exports JSON from the fixed display commands
`imu` and `mot`. It does not attach a physical device to the Drone control panel,
change the simulated receiver, or provide arming, calibration or motor controls.

The supported report identifies MPU-6500 with `who am I: 0x70`. Other firmware or
report formats fail closed. USB VID/PID selects a bridge model; it does not
authenticate an aircraft. Select the intended physical port explicitly.

## Requirements and live observation

Use a POSIX host with Python 3.10+, `lsof`, and the pinned BSD-licensed
`pyserial==3.5` dependency in `tools/drone-telemetry/requirements.txt`. The existing
esptool Python environment can be reused if it contains that version. Replay and
the parser tests need only Python's standard library.

Remove propellers and isolate motor power even with USB connected. **Opening the
port may restart the board** through OS/driver DTR/RTS behavior; this was observed
as startup messages in the device session. The adapter sets both lines inactive
before opening, but does not promise a reset-free connection. Keep that physical
setup throughout observation. A successful software reading is not a flight check.

From the GameXR checkout, supply a new output directory under the canonical
GameXR `.artifacts` location chosen for this device project:

```sh
python3 -B tools/drone-telemetry/usb_observe.py \
  --port /dev/cu.usbserial-110 --expect-usb-id 1a86:7523 \
  --acknowledge-open-may-reset --samples 2 \
  --output /absolute/path/to/GameXR/.artifacts/usb-observer/run-001
```

`--samples` accepts 1–5; the default is one. Each command has a six-second/16-KiB
response bound, and the entire operation has a 90-second ceiling. A per-port lock,
ownership preflight and exclusive serial handle prevent cooperative contention.
The adapter sends only `imu\n` and `mot\n`; it never opens a network connection,
accepts an arbitrary command, uploads firmware or resets configuration. It closes
the port after completion or failure; the existing firmware may continue running.

Startup text and raw responses stay in private local files. JSON frames contain
only whitelisted telemetry fields. Unexpected startup text, incomplete messages,
duplicate fields, unknown identity, nonfinite numbers and excessive output stop
the operation. Partial pairs are not emitted as valid observations.

## Observation semantics

Each JSON frame has schema `esp32-console-observation/v1`, a session ID and sequence,
the IMU report, software motor output values, and `actuation_available: false`.
Gyro/acceleration/rate units remain `null` because the console does not state them.
`landed_reported` preserves the firmware flag; it does not establish physical
position. Motor values are not measured voltages, movement or an arming status.
`arming_state` and `battery_volts` remain `null`.

IMU and motor reports are acquired sequentially; `simultaneous_sample` is false.
For live frames, `observed_at` is the beginning of that pair, not the firmware's
sampling timestamp. Consumers must implement an appropriate freshness limit before
displaying stored data as current. This finite diagnostic command is not a continuous
flight telemetry service or a controller input.

## Replay and validation

Put previously captured reports in a directory as `imu.txt` and `mot.txt`, then run:

```sh
python3 -B tools/drone-telemetry/usb_observe.py \
  --replay /path/to/captured-pair \
  --output /absolute/path/to/GameXR/.artifacts/usb-observer/replay-001
python3 -B tests/test_usb_telemetry.py
```

Replays use `source: replay` and `observed_at: null`; their new recording time never
turns an old sample into fresh hardware evidence. Every retained response/frame has
a SHA-256 entry in `receipt.json`. Existing output directories are refused.

The first development validation passed six parser/CLI tests, replayed the captured
USB pair, and collected two new live observation frames. These checks cover this
console profile and operation only. The original firmware source, physical pin routing,
IMU bus pins, units, power circuit and receiver failsafes remain unverified. Device
logs and configuration dumps belong in private `.artifacts`, not committed fixtures.
The standard `npm test` suite invokes the Python checks through its Node test wrapper;
neither that wrapper nor the replay tests access a serial device.
