# USB command bench, version 0.3.0

This is an observation and command-validation firmware. It has no physical motor
enable, GPIO hold-release, PWM, arming or flight-control path. The browser cockpit
remains a simulation; Wi-Fi GET endpoints remain read-only. Keep the established
propeller removal and motor-power isolation for bench operation.

## Commands

UART0, 115200 baud, ASCII, LF only, at most 95 printable bytes before LF. Use one
exclusive host connection. Never send these commands to unidentified firmware.
Confirm the `gamexr.usb-bench/v1` startup record, version `0.3.0`, `uart_code: 0`
and `outputs_enabled: false` before writing.

| Command | Effect |
|---|---|
| `GXR1 HELLO` | Zero virtual outputs and allocate a fresh session ID; acknowledge `ready` |
| `GXR1 SET <session> <sequence> <throttle> <roll> <pitch> <yaw>` | Validate and calculate a bounded virtual mixer; acknowledge `accepted` |
| `GXR1 STOP` | Zero virtual outputs and revoke the session; acknowledge `stopped` |

Throttle is an integer 0..200 permille. Rate targets are integers -1000..1000
milliradians/second, in the native sensor frame. Sequence must increase, starting
at 1, and must not exceed 2147483647. HELLO gives the session; never invent/cache it
across reconnects or faults. Send SET at most every 50 ms; the live test uses a
minimum 65 ms spacing after receiving an acknowledgment. HELLO and STOP always
clear state, while all replies share a maximum 20 Hz rate.

After 250 ms without an accepted SET (or the initial HELLO), the session expires.
It cannot resume through old SET packets: a new HELLO is required. Stale or invalid
IMU, wrong session/sequence, bad values, malformed/oversized input, UART errors,
and excessive rate revoke the session. An incomplete frame expires after 100 ms;
discarded frames drain through LF before another command can be parsed.

Responses are newline-delimited JSON alongside existing diagnostic telemetry:

```json
{"profile":"gamexr.usb-bench/v1","type":"ack","session":123,"seq":1,"status":"accepted","active":true,"lease_ms":250,"outputs_enabled":false,"motor_outputs":[0,0,0,0],"virtual_motors":[100,100,100,100]}
```

The illustrated session is a placeholder. `active` describes the virtual command
lease, never motor authority. `virtual_motors` are calculated logical X-mixer slots
0..200 permille. `motor_outputs` always remain zero. Gate reporting reflects software
commands; physical voltage and behavior during ROM/reset still need measurement.

## Control calculation boundary

The model computes untuned proportional rate damping from the current raw gyro,
then applies a logical X mixer and clamps each result. It forces all virtual outputs
to zero at zero throttle. The native sensor frame, logical slots, board orientation
and physical motor rotation directions have not been matched by this work. No
attitude estimation, integral control, dynamics identification, PID tuning, thrust
calibration or closed-loop stability acceptance is provided. These calculations
must not be connected to motors as a flight controller.

The session number separates stale commands; it is not cryptographic authentication.
This human-readable local bench protocol has no command checksum and is not a
validated transport for physical flight.

## Reproducible checks

`node --test tests/usb-diagnostics-firmware.test.ts` compiles the portable model
with AddressSanitizer and UndefinedBehaviorSanitizer. It tests expiry boundaries,
replay/reordering, stale/invalid IMU, framing/partial input, ranges, cadence, response
truncation, zero-throttle, mixer signs/saturation and 100,000 deterministic hostile
bytes. These are software/model checks, not flight tests.

The `tests/live_usb.py` harness reuses the existing `serial_port` exclusive reader
via PYTHONPATH, requires `--allow-bench-commands`, and requires a new output directory.
It limits the run to 90 seconds and 490,000 captured bytes. It checks live protocol
faults, 20 command-silence expiries, virtual mixer outputs, and host close/reopen
with a stale session. The close/reopen case does not simulate a physical unplug.
On failure it closes the port and saves evidence; there is no automatic retry or
arming. A lost sender leaves authority to expire in the device's own loop.

## Current device evidence

Version 0.3.0 was flashed at application offset 0x10000 with a verified fresh full
backup and unchanged bytes outside the erased app sectors. The first live run
passed nine checks before USB hardware connection loss; its evidence remains in
`GameXR/.artifacts/usb-bench-2026-09-25/live-01`. The physical cause is unresolved.

The requested recheck found `/dev/cu.usbserial-1110`, USB location `1-1.1`, and
reconfirmed ESP32 MAC `08:b6:1f:9a:ea:50`. Existing firmware 0.3.0 passed all 14
live checks in 17.009 seconds, including partial-frame expiry, STOP, all 20 silence
expiries with no old-session resume, the logical mixer, and host close/reopen.
Expiry reports arrived 247.10..268.83 ms after the accepted-command acknowledgment;
these are host observations, not physical motor-cutoff measurements. All observed
acknowledgments reported disabled outputs and actual motor values [0,0,0,0].
No disconnect occurred during the run, and the port was closed afterward. No flash
write occurred. Receipts: `GameXR/.artifacts/usb-bench-2026-09-25/live-02`.

This bounded pass does not establish long-term USB reliability or resolve the old
disconnect's cause. Physical motor and stabilization validation remain pending.
Battery calibration continues under KIV; no new battery-health assumption is introduced.

The later five-minute observation completed on this port without USB disappearance
or an unexpected reboot, but it failed data integrity: 2,999 valid samples and two
malformed frames across sequences 0..3000. The conditional command-suite rerun was
skipped. Evidence: GameXR/.artifacts/usb-stability-2026-09-25-KfEBgD. The earlier
14-check pass is retained; sustained telemetry integrity remains unresolved. No
firmware changes were made by the stability test. Keep actual outputs inhibited.

User priority update: USB disconnect and malformed-telemetry investigation are KIV.
Do not continue cable comparisons or USB stability captures automatically. Preserve
the failed acceptance result while proceeding with read-only phone Wi-Fi/camera
validation and offline work. This deferral grants no physical motor authority.
