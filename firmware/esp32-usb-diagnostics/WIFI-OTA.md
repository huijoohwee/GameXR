# Authenticated phone OTA — 0.4.6

Continuity: GAMEXR-WIFI-OTA-001@0.1.5. Phone confirms OTA to 0.4.7 and recovery to 0.4.6; motors disabled.
Build: `GameXR/.artifacts/wifi-ota-2026-09-25`; hardware: `wifi-ota-transport-2026-09-26`.

## PRD / MVP

Let the paired operator update the ESP32 from iPhone Safari on the drone's own
Wi-Fi using a local application BIN and its matching manifest JSON. Reuse the
trusted device certificate, private pairing link, dashboard and Espressif SDK.
No cloud, paid service, native phone app, new package, or motor control is added.
0.4.6 includes the 0.4.5 Wi-Fi stationary capture feature; calibration remains unapplied.

The initial target was 30–40 minutes. Validation expanded to test actual boot-guard
code with SDK fault doubles. Bounds: one firmware lane; modules <600 lines; total
embedded cockpit <300 kB gzip; inactive app <=0x140000 bytes; 4 kB upload buffer.
Bulk USB corruption and full-range battery calibration remain unresolved. OTA cannot
bootstrap itself onto 0.4.4. Its one-time installation is now verified as described below.

## TAD / ADR

- `device_auth` is the shared existing-key owner. The HTTPS-only routes require
  exact Host, a 64-byte pairing key, and exact same Origin for mutations. GET may
  omit Origin but rejects a different supplied Origin. No CORS or public uploader.
- `ota_policy` validates the ESP32 image prefix, project identity and 0.4.6+ version,
  SHA text, and startup health policy. `ota_update` owns stream/write/readback.
- `ota_guard` hashes actual bootloader [0x1000,0x8000) and partition sector
  [0x8000,0x9000), using official PSA SHA-256, against exact compiled build digests.
  Missing/mismatched digests lock OTA. Rollback is enabled in the bootloader config.
- `GET /api/ota` provides paired status and records authenticated observation of
  this boot. Readiness requires the verified bootstrap, network initialization,
  50 consecutive healthy IMU readings, and observation. The SDK must successfully
  mark this image VALID, including the initial bootstrap, before upload is allowed.
- `POST /api/ota` accepts only an exact-length application/octet-stream body
  (1,024..1,310,720 bytes), `X-GXR-SHA256`, `X-GXR-Bootloader`, `X-GXR-Partitions`,
  and `X-GXR-Key`. It validates the first 288 bytes before erasing the inactive slot.
  Boot selection must still identify the running app. Only app0/app1 are eligible.
- Hash the upload, finish official ESP-IDF image validation, and independently hash
  written flash before selecting it for next boot. Partial uploads, wrong hashes,
  wrong chip/project/version, native verification or flash failure abort the update.
  Reject paths close the upload connection. Failed candidates are not selected.
- The current app remains intact. The inactive slot's previous contents are replaced;
  an interrupted upload can therefore consume the older recovery copy. NVS,
  filesystem, partition table and bootloader are never OTA payload targets.
- One update at a time. OTA clears/suspends Wi-Fi bench authority and pauses USB
  bench polling; browser bench/capture stop. Outputs remain held low in all app paths.
  No claim is made about ROM/reset pin voltage; physical motor isolation remains required.
- Upload has a 90-second device deadline and 100-second browser deadline. Responses
  are bounded, and readback polls for up to 40 seconds without resending the upload.
  Missing acknowledgment, lost Wi-Fi or hidden Safari yields an unconfirmed result.
- A new PENDING_VERIFY app arms a 45-second reset timer. Health plus paired status
  observation confirms it; otherwise the SDK rolls back, or reset lets the verified
  bootloader reject it. The initial confirmed predecessor must already exist.
- `POST /api/ota/recover` requires the same authentication, an empty body and an
  available SDK recovery slot containing compatible GameXR 0.4.6+ firmware. It marks
  the current app invalid and restarts. Legacy vendor firmware is not a recovery target.

SHA-256 plus HTTPS and pairing authenticates the operator and checks file integrity;
it is not a publisher signature or Secure Boot. Use this lane's reviewed, locally
built packages. The manifest is not signed, and the version/project check alone
cannot establish safety of arbitrary code. No eFuse, flash encryption or anti-rollback
provisioning occurs. This is a private bench updater, not a public distribution service.

## Build / package

1. Run `tools/package-cockpit.mjs PHONE_CHECKOUT ARTIFACT_DIRECTORY` with the pinned
   clean phone revision documented in WIFI-COCKPIT.md. Freeze source/generated/private
   inputs under that artifact directory; never publish embedded private keys.
2. Build the frozen project with official ESP-IDF MCP. Keep
   `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y`. Bind exact generated bootloader and
   partition hashes using `node tools/package-ota.mjs bind FROZEN_PROJECT ARTIFACT_DIRECTORY`.
3. Reconfigure/rebuild after binding. For example, touch the frozen main/CMakeLists.txt
   before `build_project`. Run `package-ota.mjs package` with the same arguments.
   Packaging fails on bootstrap drift, wrong layout, oversized or invalid app image.
4. Retain `ota/gamexr-0.4.6.bin`, its matching JSON, source/build receipt and
   `bootstrap/plan.json`. The padded bootloader and table digest include erased FF
   bytes. Verify actual flash against these exact ranges during bootstrap.

For subsequent app-only builds, preserve the baseline private digest inputs and run
`package-ota.mjs package-app FROZEN_PROJECT ARTIFACT_DIRECTORY BASELINE_ARTIFACT_DIRECTORY`.
This validates the app's embedded pins and current table against the retained baseline;
it does not select the newly rebuilt bootloader or generate a bootloader write plan.
A compile timestamp can change that unused bootloader even with identical configuration.
The initial `bind` / `package` workflow continues to reject bootstrap drift.

## USB bootstrap verified; physical OTA acceptance pending

Retain the historical full backup and verified 0.4.4 app/full backup under
`GameXR/.artifacts/wifi-drone-mode-2026-09-25-final`. Before any installation, obtain
and hash a fresh complete device backup, confirm identity, actual partition table
and current boot selection. Reuse the existing physical-isolation grant.

The prepared bootstrap plan writes only the rollback-enabled bootloader at 0x1000
and candidate app at 0x10000, conditional on verified app0 selection. It compares
but does not rewrite the table; preserves NVS, otadata, app1, SPIFFS and coredump.
If boot selection differs, stop and produce a new exact plan. Do not run generic
`idf.py flash`/MCP flash_project: their default arguments include table and otadata.
Bootloader replacement is not power-loss-safe; the currently unresolved USB path
cannot be treated as reliable merely because this candidate builds.

After exact readback and startup checks, establish 0.4.6 as a healthy VALID baseline.
Then demonstrate an authenticated app-only OTA, verify reported version/ELF digest,
and demonstrate rollback with a deliberately unconfirmed motor-disabled test build.
Exercise interrupted transfer, Wi-Fi loss, pending-boot reset and explicit recovery,
retaining before/after flash selection and status receipts. Power-cut/real rollback
acceptance remains pending. Do not label host simulations as hardware recovery proof.

## Phone workflow after bootstrap

1. Join `XW_Drone_WiFi` and use the private pairing link for the already trusted
   `https://192.168.4.1:8443/gamexr/`. Keep Safari visible and board power stable.
2. Open Connection → Firmware update. Check device; wait for OTA ready.
3. Choose the matching JSON and application BIN from Files. Browser verifies SHA-256.
   Check stable power/motor isolation and tap Upload and restart.
4. Rejoin the AP if necessary. Readback confirms version, ELF digest and startup
   validation; reload the dashboard. If unconfirmed, check status before retrying.
5. Recovery → Restore previous firmware is available only for a compatible valid
   predecessor. Check device afterward. A failure to boot/network still needs
   automatic bootloader rollback or USB recovery, not a browser action.

No Mac gateway or USB is needed for subsequent compatible app updates after this
bootstrap and its physical acceptance. Battery-only operation still depends on
adequate board power and isolation; this work does not resolve battery calibration.

## Validation / release / GTM

The official pinned ESP-IDF MCP builds the candidate. Host tests run production
upload and boot-guard code with explicit SDK failure doubles and ASan/UBSan. They
cover auth, exclusive maintenance, truncated uploads, hash/image/flash failures,
startup timeout/confirmation, bootstrap mismatch and compatible recovery. Browser
SHA tests use the real Web Crypto primitive. C SHA doubles test call ordering,
not the cryptographic primitive. Real flash durability and power loss remain untested.

The loopback preview is explicitly synthetic: no serial port, Wi-Fi device connection,
or real pairing key. Browser validation rejects a mismatched file, uploads a matching
synthetic package, confirms simulated restart, restores the simulated predecessor,
and inspects the 390×844 layout. Receipts are stored with the candidate.

Source publication remains blocked by inherited native-build CI/shared ownership;
no native CI, source integration or production deployment is claimed. Local checks
and artifacts do not grant release authority. GTM value: maintain private bench
firmware from the existing phone workflow with no ongoing service cost. Motor
actuation, flight acceptance, manufacturer-signature distribution and cloud OTA
remain outside this milestone.

Reference: [Espressif OTA API and rollback states](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html),
verified against the pinned local SDK `fff9895c82d744c7237be8847347bdd1b07c6643`.

## Physical attempt — 2026-09-26 (Singapore)

The user authorized USB bootstrap plus physical OTA/rollback validation. Resumed the
same admitted lane and reused the motor-isolation grant. USB now enumerates as
`/dev/cu.usbserial-1110`, bridge 1a86:7523, location 1-1.1. Chip MAC
08:b6:1f:9a:ea:50 and flash 0x16405e match the retained device identity.

Fresh 4 MiB backup attempts failed at both 460800 and 115200 baud: expected 4096-byte
blocks, received 3849 and 4084 bytes respectively. No complete verified new backup
was produced; no flash erase/write or eFuse operation was attempted. Bootstrap,
real OTA and physical rollback remain blocked on USB transfer integrity. The cause
is not established; no third unchanged transfer attempt was made.

Normal reset returned existing 0.4.4 to service: HTTPS 8443, motor outputs disabled,
MPU6500 identity 112 and 140 healthy IMU samples were observed. The port was closed.
That boot capture is not proof of reliable flash transfer. Mac Wi-Fi was not changed;
retain dlink-F205 as the operator-provided return network for later OTA testing.

A version-only 0.4.7 rollback probe was built and packaged against the retained
0.4.6 bootstrap after fixing the app-only packaging owner. It is an uninstalled
test image; the final target remains 0.4.6. The bootstrap installer is prepared but
was not executed. Evidence: GameXR/.artifacts/wifi-ota-live-2026-09-25.

Next owner action: establish a known-good direct USB data path, then resume fresh
backup/readback preflight. Preserve both failed receipts and the historical backups.
No production/source release, successful OTA, or physical rollback is claimed.

## Authorized connection retry — 2026-09-26 (Singapore)

The user requested another attempt after the connection changed. The bridge now
enumerates at `/dev/cu.usbserial-2110`, location 2-1.1. One bounded preflight was
prepared for a fresh 4 MiB backup at 115200 baud, with an eight-minute limit.
Its initial passive read failed after about 1.6 seconds: `Errno 6: Device not configured`.
No esptool connection, fresh chip-MAC verification, backup read, deliberate reset,
flash write or eFuse operation occurred. The serial handle was closed and unowned.

The captured boot record reports existing 0.4.4, MPU6500 identity 112 and motor gates
held low. A healthy continuing stream was not established. The bridge reappeared;
fresh USB ancestry still places it beneath the Apple USB 2.0 hub associated with
the multiport adapter. Moving the connection did not bypass that hub. The failure's
root cause remains unconfirmed; no unchanged retry loop or Wi-Fi change followed.

Preserve all historical backups. Bootstrap and physical OTA/rollback remain pending.
Next: bypass the still-present hub with a known-good direct USB data path, then
retry the guarded identity/backup/MD5/partition/boot-selection preflight. Evidence:
`GameXR/.artifacts/wifi-ota-retry-2026-09-26/HANDOFF.md` and its JSON receipts.

## Direct USB retry — 2026-09-26 (Singapore)

The user confirmed the adapter was bypassed and authorized retry. Fresh USB ancestry
verified bridge 1a86:7523 directly beneath the Mac controller, with no intervening hub,
at `/dev/cu.usbserial-110`, location 1-1. The chip MAC and flash ID matched. Initial
passive capture contained 39 healthy IMU samples with motor gates held low.

The bounded 115200-baud full backup failed after about 165 seconds: expected 4096
bytes, received 4091. No complete new backup was produced and no flash/eFuse write
occurred. This demonstrates that the failure persists without the hub; it does not
identify the remaining cause. Do not repeat the same transfer without new evidence.

A guarded normal reset exited the RAM readout stub. Existing 0.4.4 booted, advertised
HTTPS 8443 and reported outputs disabled. The capture contained 139 valid healthy IMU
samples and one malformed JSON line; the serial port was closed. Transfer integrity
remains unresolved. Mac Wi-Fi was not changed, and original backups remain retained.

Exact bootstrap and physical OTA runners are prepared but were not executed. Candidate
0.4.6 and the uninstalled 0.4.7 probe remain unchanged. USB bootstrap and OTA/rollback
acceptance stay pending. Next diagnostic boundary: isolate the remaining cable,
host USB driver, or board-side link with a controlled comparison before another write
attempt; broader root-cause investigation remains KIV until requested. Evidence:
`GameXR/.artifacts/wifi-ota-direct-2026-09-26/HANDOFF.md` and its JSON receipts.

## Transport alternatives — 2026-09-26 (Singapore)

The user reopened USB diagnosis and authorized alternative fixes. Fresh driver
inspection found Apple's built-in AppleUSBCHCOM bound to the direct USB bridge;
no competing driver was established and no driver installation/removal occurred.

Separate official 1 KiB stub read transactions retained per-transaction MD5 checks
and a stable whole-flash checksum across reconnects. They preserved a verified
2.5 MiB prefix, then stopped at the total two-reconnect budget after a third corrupt
block. This recovers useful checked bytes but does not solve the underlying fault.

The alternative ROM-only preflight passed. The ROM independently reverified that
prefix and the remaining 1.5 MiB suffix from the retained historical backup, then
matched the complete 4 MiB reconstruction against chip MD5 before and after. A
separate 4 KiB ROM read of application bytes matched too. The resulting SHA-256 is
b60b46f7b3fdc046d0fe4e94977f8da9a9567a0cb1920b8dc6b2f546aa536ad6,
identical to the retained verified 0.4.4 full backup. This is a freshly reverified
complete snapshot, not a fresh byte-for-byte USB read of every flash address.

PRD/MVP: unblock the existing local OTA bootstrap without weakening backup or
identity checks. TAD/ADR: retain official esptool; use the chip's ROM loader instead
of the failing RAM-stub read stream. Install with 1 KiB acknowledged write blocks,
native 64-byte ROM read responses, per-read MD5 and full-payload SHA-256 readback.
Set one whole-image write attempt; uncertain writes require reconciliation.
Preserve all flash outside the exact app/bootloader sectors with full-device MD5.
GTM: a local recovery path with no extra package, service cost or driver change.

The ROM bootstrap was completed after the preservation repair described below.
Physical OTA/rollback remains pending. Evidence:
`GameXR/.artifacts/wifi-ota-transport-2026-09-26`, including the `rom/` preflight.
Protocol reference: [Espressif serial protocol](https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/serial-protocol.html).

### Preservation recovery and installed result

The application and padded rollback bootloader both passed full native-ROM SHA-256
readback. The subsequent complete-device MD5 did not match the composed target;
the controller stopped without booting. Read-only reconciliation isolated changes
to the partition-table sector and app tail/unused app0 sectors. NVS, otadata, app1,
SPIFFS and coredump still matched the original snapshot. Espressif's own tests
document the ESP32 ROM compressed-write limitation affecting following regions:
[esptool tests](https://github.com/espressif/esptool/blob/master/test/test_esptool.py).

An initial four-sector repair ceiling rejected the observed eight-sector set before
writing. A fresh exact plan then restored 0x8000 and 0x129000..0x12ffff, using
uncompressed ROM writes and SHA-256 readback of every repaired sector. The final
whole-flash MD5 matched the exact intended snapshot. Its retained 4 MiB SHA-256 is
261948eb76e16ced17cebaa920fb31be23812023fb1509947ead88a479622387.
The partition table and all protected data are restored to their original bytes.
This was a preservation repair, not a layout migration. No erase-all/eFuse operation
occurred. Future ROM writes must use uncompressed transfers; do not replay the
failed compressed installer. Preserve its failed receipt and both repair receipts.

The exact 0.4.6 app and rollback bootloader are installed. Normal boot, HTTPS 8443,
MPU6500 identity 112, outputs disabled and 426 valid IMU samples were observed.
The serial capture had one malformed JSON line: bulk/telemetry corruption is still
unresolved, despite the successful verified installation workaround.

### Physical OTA boundary

The prepared Mac HTTPS acceptance runner attempted to join XW_Drone_WiFi but could
not reach the OTA endpoint. It sent no OTA upload/recovery request. The saved
networksetup command returned zero despite a failure message; exit code alone is
not association proof. The first restoration check was too early to establish the
home route. A later observation found the original 192.168.0.105 address and
192.168.0.1 gateway; macOS still hides the actual SSID. Settings UI automation failed
with a ScreenCaptureKit error and made no verified connection change.

The operator used the trusted iPhone, saved private pairing link and Connection →
Firmware update → Check device, reporting “Firmware 0.4.6 boot verified OTA ready”.
This is operator-reported paired readiness; no independent Mac API observation was
obtained. The operator subsequently confirmed “Firmware 0.4.7 verified after restart.”
This records a successful physical phone OTA and startup readback by operator report.
The panel only emits that message after version/ELF identity, confirmed boot, verified
bootstrap and ready status match. No independent Mac API response was captured.
After the recovery instructions and disabled-button clarification, the operator
confirmed “Firmware 0.4.6 · boot verified · OTA ready.” Explicit recovery back to
the baseline is therefore recorded as operator-confirmed. No independent Mac API
response or flash-selection readback was captured. Pending-boot rollback,
interrupted-transfer and power-cut tests remain outstanding; calibration is unapplied.

The private 0.4.7 test ZIP was supplied for extraction and paired JSON/BIN selection.
The operator's reported successful restart supersedes the earlier uninstalled status.
The version-only probe, baseline and bootstrap pins passed fresh SHA-256 checks;
archive extraction reproduces the pinned app. No firmware source changed or device
request occurred for this preparation. Receipt and instructions are retained under
`GameXR/.artifacts/wifi-ota-phone-2026-09-26`. Keep earlier failed receipts immutable.

Next acceptance work: automatic unconfirmed-boot rollback and interrupted uploads
need separate controlled runs. Manual recovery does not prove those behaviors.
The recovery API marks the outgoing app invalid; do not assume it remains an
eligible fallback merely because it booted successfully earlier. Observe fresh status
and establish the exact running baseline before another controlled update test.
The independent phone capture task passed offline review of the supplied 200-sample
JSON plus a passive USB repeat; see WIFI-CALIBRATION.md, GAMEXR-WIFI-IMU-CAPTURE-001@0.1.2. Gyro candidate
remains inactive. Keep motor isolation; battery calibration stays KIV; flight unvalidated.
Evidence: `wifi-ota-phone-2026-09-26/ota-0.4.7-operator-confirmation.json` and
`wifi-ota-phone-2026-09-26/recovery-0.4.6-operator-confirmation.json`.

Authoritative chain: `rom/usb-preflight.json` → `bootstrap-receipt.json` (failed
preservation check) → `reconcile.json` → `preservation-repair-v2.json` (complete
target verified and boot requested) → `physical-ota.json` (Wi-Fi reachability blocked).
Source publication and production/flight acceptance remain separate and unclaimed.
