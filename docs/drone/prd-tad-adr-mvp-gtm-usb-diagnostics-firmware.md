# USB diagnostics firmware implementation

Continuity: GAMEXR-USB-DIAGNOSTICS-FIRMWARE-001@0.1.0.
Parent: DRONE-RC-001@0.2.0. Scope: new native firmware project, build and host checks;
physical loading and flight control are separate effects.

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
No managed components, runtime MCP, radio stack, receiver or persisted settings are
introduced. Sensor coordinates remain untransformed; units and errors are explicit.

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

Development: implementation complete for the build-only milestone. The official
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
Production release: not deployed. Runtime: no device access or write in this change.
The smallest useful outcome is an inspectable bench diagnostics image and honest
fault reporting before stabilization work. Preserve device-specific NVS and full
backup as recovery evidence. Source publication follows agentic-os RELEASE and
stops at provider handoff; physical installation is separately bound to exact files.
