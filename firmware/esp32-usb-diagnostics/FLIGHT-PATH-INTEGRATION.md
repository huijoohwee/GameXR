# Browser and firmware flight-path integration

Continuity: GAMEXR-FLIGHT-PATH-INTEGRATION-001@0.1.0, 2026-09-26.
Parent: GAMEXR-USB-DIAGNOSTICS-FIRMWARE-001@0.3.1.

## PRD

Reconcile the parallel Graph path producer and GameXR browser receiver with the
embedded firmware packaging. Keep the existing owner checkouts and independent
hardware boundary. The user authorized this integration and bench validation,
and asked whether these paths can execute physical flight. They cannot today.
Sprint: 20 minutes, eight source/doc files, 40 KiB changed text, zero new dependencies.
External owner publication is a dependency, not an ETA. Artifacts belong in
`GameXR/.artifacts/flight-path-reconcile-2026-09-26`.

## TAD

- Graph owns Python-derived kinematic samples and v1/v2 export contracts. The
  committed compatible baseline is `f87cb03d772f2b457a14145645b7d240758500bc`.
  Its owner is extending native-link/Canvas sharing in a successor; that mutable
  worktree/artifact is not an input to this firmware build.
- GameXR browser revision `9a051ac63960886a52411016aab992380bbedcd6` consumes those
  contracts. Its paired host receiver acknowledges simulated positions. The
  Graph Canvas is an optional host-mounted artifact, not embedded in ESP32 flash.
- `cockpit-source.lock.json` pins that browser revision and its complete release
  artifact digest. Packaging verifies the clean checkout, build identity, exact
  file set and file hashes, then reuses Motion, Camera and diagnostics modules.
- ESP32 `/gamexr/` stays the dedicated diagnostics/bench dashboard. It receives
  authenticated bounded rate/throttle bench commands and holds motor gates low.
  `/gamexr/game.html` contains the updated browser shell; a simulated path still
  needs the host receiver. The firmware has no WebSocket/UDP position-path endpoint.

## ADR

Use explicit compatible source/artifact pins; do not merge whole worktrees or copy
another owner's source modules. Preserve `physicalAircraft=false` and separate
Graph position samples from the firmware's rate/throttle units. No guessed
position-to-throttle conversion, automatic arming, calibration activation or device
write is part of this reconciliation. Version 0.4.8 identifies the new build-only
candidate; the confirmed 0.4.6 and all recovery artifacts remain unchanged.

## MVP / validation

Check mismatched revisions, stale/modified build bytes, extra files and rejected
physical-execution claims. Re-run the owner's path/transfer contract tests and
firmware host tests. Package the pinned build within 300 kB total gzip and 250 kB
per asset; no source chunk reaches 500 kB. Build the ESP32 candidate and verify its
0x140000 application slot limit. Reuse bound owner browser landing evidence;
preview the packaged firmware dashboard with a synthetic receiver separately.
Record exact results and source hashes in the integration artifact receipt.

## Physical-flight prerequisites

Physical path execution needs measured body-axis signs, validated IMU calibration,
an attitude/rate estimator and controller, mapped motor order/direction/mixing,
arming and fault handling, and propeller-free motor acceptance. Position paths
also need a verified position/altitude/heading estimate and tracking controller;
the current IMU telemetry alone does not provide that position reference. Battery
measurement remains KIV for diagnostics but must be resolved for flight acceptance.
Only then can staged restrained and controlled flight tests establish a supported
path envelope. Historical settings are reference evidence, not a validated tune.

## GTM / release / rollback

Deliver a reproducible bench development bundle, not a flight-ready release.
Development, source publication, device deployment and physical acceptance have
separate receipts. RELEASE uses the existing native controller; no shared CI file
or parallel owner's branch is modified. Keep the previous pin/build and installed
0.4.6 recovery images. Rollback this packaging increment by restoring the previous
source/artifact pin and rebuilding; do not change the device during this pass.

## Development evidence, 2026-09-26

- 31 firmware host tests and nine receiver path/transfer tests pass; UI TypeScript passes.
- Replayed the owner's recorded 541-sample Graph path through the pinned receiver:
  all positions acknowledged, final pose `[540,4,0,0,0]`, watchdog expiry cleared
  authority, and `physicalAircraft=true` was rejected. Deterministic host simulation.
- Official Espressif MCP built 0.4.8: 1,159,888 bytes, below the 1,310,720-byte slot.
  App SHA256: `6a13d0cfa8a495c38aa272ffca2a42efcdb0fbc581b4d73620d70e69b5a91d4b`.
  The app-only package preserves the retained bootstrap identities; no device write.
- Packaging: 28 assets, 279,570 gzip bytes total, 26,210 drone entry/cache bytes.
- Actual Codex browser at `http://127.0.0.1:4200/gamexr/`: synthetic IMU increments,
  Start receives ACK, 40% UI throttle yields 80/1000 virtual outputs and zero
  physical outputs, BRAKE stops and clears outputs, zero canvas elements.
- Owner's native-link browser landing receipt was reviewed separately; ongoing
  Graph sharing changes and real iPhone/hardware acceptance are not certified here.

Exact logs, package, source snapshot, replay and browser server evidence are in
the artifact directory above. Source publication status is recorded in its
`release-publish.log` and `REPORT.md`; local build proof is not integration proof.
