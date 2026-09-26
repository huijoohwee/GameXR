# ESP32 USB and direct Wi-Fi diagnostics firmware

This standalone ESP-IDF application is the first replacement-firmware milestone:
motor gates low, MPU-6500 observations and battery ADC telemetry over UART0/USB at
115200 baud, with a device-hosted phone page since version 0.2.0 and bounded USB
dry-run commands since 0.3.0. It has no physical receiver integration, calibration
persistence, motor PWM, arming, validated stabilization or flight control.
See [USB bench protocol](USB-BENCH.md). It does not read or write NVS. Wi-Fi configuration stays in RAM;
PHY calibration uses RAM and is repeated at boot.

New application code uses the repository MIT license. Dependencies are the official
ESP-IDF components in `sdk.lock.json`; no vendor flight firmware or FlixPeriph code
is included. This is an independent implementation from register documentation and
hardware facts, not a claim of a legally audited clean-room process.

## Board contract

| Function | Configuration |
|---|---|
| Target | ESP32 only; observed ESP32-D0WDQ6 revision 1.1, 4 MiB flash |
| Motor gates | FL14 / FR15 / RL12 / RR13; zero latch before output enable, pull-down, GPIO hold |
| IMU | MPU-6500 WHO_AM_I 0x70 only; SPI3, SCK18/MISO19/MOSI23/CS5, mode 0, 1 MHz |
| Sampling | IMU 100 Hz, telemetry 10 Hz, fresh data-ready status required |
| Units/frame | m/s^2 and rad/s, native sensor frame; no mounting transform or bias calibration |
| Battery | ADC1 channel0/GPIO36, 12-bit, 12 dB attenuation, 16-sample average, 43/33 divider |
| Serial | UART0 via existing USB bridge; JSON observations and GXR1 diagnostic commands; actual outputs remain zero |
| Receiver | Unused; GPIO4/16 conflict remains unresolved |
| SDK | ESP-IDF 6.1 at fff9895c82d744c7237be8847347bdd1b07c6643 |

The first application action inhibits all four gates. An inhibition API error stops
sensor initialization and emits a fatal record. GPIO holds are not a guarantee
about ROM, bootloader, reset, hardware failure or an incorrectly identified board.
Keep propellers removed and motor power physically isolated for initial loading.
No physical motor-isolation claim is encoded in telemetry.

IMU configuration is checked by readback; unknown identities are not reset or
configured. Initialization failures remain explicit until reboot. Later I/O or
data-ready failures emit null vectors instead of stale samples. A missing sensor
cannot enable motors. SPI calls use the sole device on a dedicated bus.

Battery calibration uses eFuse data only. Without it, raw data is available but
millivolt fields are null. The conservative ADC range is 150..2450 mV; saturation
or values outside this range give `out_of_range` and null `battery_mv`. The board's
10k/33k divider would present about 3223 mV for a hypothetical 4.2 V supply, so its
full battery range cannot be claimed accurately measured by this milestone. No
battery chemistry, percentage, presence or flight-health inference is made.

## Build and host checks

Activate the pinned official SDK and verify its Git commit before building. No new
SDK migration is applied to the preserved original firmware. Keep output outside
the checkout, using the user's GameXR/.artifacts location:

```sh
source /Users/huijoohwee/.espressif/tools/activate_idf_v6.1.sh
idf.py -C firmware/esp32-usb-diagnostics -B /absolute/GameXR/.artifacts/diagnostics-build \
  -D SDKCONFIG=/absolute/GameXR/.artifacts/diagnostics-build/sdkconfig build
node --test tests/usb-diagnostics-firmware.test.ts
```

Replace the illustrative artifact path with the actual canonical GameXR path.
The official ESP-IDF MCP build tool accepts only `project_dir` and always creates
`project_dir/build`. To keep its output in .artifacts, use a hash-verified source
snapshot there and retain its source manifest. Do not silently build a stale copy.

Native build settings use DIO/40 MHz and a partition table with the captured offsets
and sizes. Matching partition definitions alone do not preserve on-device contents
when a write command is issued. `idf.py flash` is not part of the build workflow.
Do not replace the device-specific full backup with a generated merged image.

## Telemetry contract

Only records with `profile: gamexr.usb-diagnostics/v1` belong to this protocol;
ROM/bootloader/SDK log lines may precede them. `boot` includes version, SDK,
WHO_AM_I and initialization results. `sample` includes sequence, monotonic uptime,
motor gate command, IMU status/vectors and battery status/raw/voltage. Failed
measurements are null. `adc_mv` outside range is diagnostic only. `fatal` reports
an application error. Sequence resets on boot. No wall-clock timestamps are claimed.

`motor_gate_command: low_held` reports the successful GPIO API requests, not a
physical motor measurement. Existing vendor-console USB observers use a different
profile and must not interpret these records as their legacy CLI responses.

## Device validation and rollback boundary

This milestone is buildable source until an exact flashed-image receipt and boot
capture exist. A later flash must identify the selected chip/MAC, preserve the
verified full 4 MiB backup, bind exact files/offsets and retain recovery bytes.
Check boot identity, WHO_AM_I, null/error handling and externally verified gate
levels before any actuator work. Do not run an erase-all, change eFuses, or treat
host tests as physical evidence. Restore only the device's own recorded backup
after matching identity and an explicit restore decision.

## Direct phone connection (0.2.0)

After exact-device installation, join `XW_Drone_WiFi` with password `12345678`.
Stay connected when the phone reports no internet. This reuses historical network
details but serves a new diagnostics application, not the vendor flight controller.

- `http://192.168.4.1:8080/`: page and IMU telemetry; camera is unavailable on HTTP.
- `https://192.168.4.1:8443/`: the same page with opt-in local phone camera, when
  the private build includes TLS inputs and the phone trusts its certificate.
- `GET /api/telemetry`: `gamexr.direct-wifi/v1` envelope around the USB sample,
  a per-boot session nonce, sample age, and `actuation_available: false`.
- No command endpoints are registered. Old `/web_rc` commands are unsupported.

The browser polls at most every 300 ms, stops after five failures, and requires
advancing sequence numbers. It clears readings at 1.5 seconds, stops camera tracks
when hidden, and releases late camera grants. Camera frames remain on the phone.
Only raw sensor values and gravity-derived tilt are shown: no synchronized camera
pose, stabilization, full-range battery calibration, or flight-ready inference.
Battery calibration remains KIV. Two Wi-Fi clients are allowed for bench use.

The page is embedded without the desktop application's 3D/runtime dependencies.
The loopback fixture is visibly labeled synthetic and never accesses USB:

```sh
npm run dev -- --config firmware/esp32-usb-diagnostics/tests/preview.config.mjs
```

### Private TLS build inputs

An artifact source snapshot may contain ignored `private/server.pem` (PEM leaf
certificate), `private/server-key.pem` (PEM private key), and `private/ca.cer`
(DER public issuing root). The leaf must cover IP `192.168.4.1` with serverAuth.
Absent inputs produce an HTTP-only image. Incomplete inputs fail the build.
Private keys and images embedding them stay in `GameXR/.artifacts`, never Git.
Source and configuration hashes plus certificate validity belong in the build receipt.

Use a short-lived local root and verify the public root fingerprint through the
Mac setup record before installing/trusting it on the phone. Trust is a user
action; do not bypass a browser certificate warning. The root can authenticate
certificates it signs, so remove it after this bench setup. No cloud CA, paid
service, browser exception, or native phone application is needed. When certificates
expire, provision and verify fresh inputs before rebuilding. Candidate 0.4.6 adds
the guarded updater described in [WIFI-OTA.md](WIFI-OTA.md); installed 0.4.4 cannot use it.

### Meaning of a fresh application

The independent diagnostics source contains no vendor flight implementation. This
does not mean an erase-all has occurred. Historical full-flash backups are retained;
NVS, filesystem data, and inactive flash regions are preserved and unused by this
application. Keep that distinction in device receipts. An app-only update binds
offset `0x10000`, verifies partition compatibility, preserves a fresh full backup,
and checks that all bytes outside the erased application sectors are unchanged.

## Primary technical references

- [TDK MPU-6500 register map, RM-MPU-6500A-00 rev 2.1](https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6500-Register-Map2.pdf): identity, configuration and burst register addresses.
- [TDK MPU-6500 product specification rev 1.3](https://invensense.tdk.com/wp-content/uploads/2020/06/PS-MPU-6500A-01-v1.3.pdf): SPI interface and sensitivity.
- [ESP-IDF pinned ADC example](https://github.com/espressif/esp-idf/blob/fff9895c82d744c7237be8847347bdd1b07c6643/examples/peripherals/adc/oneshot_read/main/oneshot_read_main.c) and component headers: native driver APIs.
- [Espressif ESP32 ADC range](https://docs.espressif.com/projects/esp-idf/en/v4.4.8/esp32/api-reference/peripherals/adc.html): conservative 12 dB characterized range.

Hardware facts are recorded in the private reference BOM/schematic and original
USB evidence. Their document identity does not establish this unit's PCB continuity.

## Direct cockpit 0.4

See [WIFI-COCKPIT.md](WIFI-COCKPIT.md) for the complete direct-Wi-Fi cockpit,
Motion default, historical input-curve provenance, build packaging and phone steps.
The legacy read-only page is now `/diagnostics`; `/` redirects to the HTTPS cockpit.
The authenticated Wi-Fi bench computes virtual outputs with physical gates held low.

## Authenticated OTA candidate 0.4.6

See [WIFI-OTA.md](WIFI-OTA.md) for Safari upload, image verification, recovery,
and the required one-time rollback-bootloader USB bootstrap. Candidate only;
physical installation and recovery acceptance remain pending.
