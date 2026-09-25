# USB console observation

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
