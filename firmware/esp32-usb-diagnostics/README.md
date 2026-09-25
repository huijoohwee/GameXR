# ESP32 USB diagnostics firmware

This standalone ESP-IDF application is the first replacement-firmware milestone:
motor gates low, MPU-6500 observations and battery ADC telemetry over UART0/USB at
115200 baud. It has no input parser, receiver, networking, calibration persistence,
PWM, arming, stabilization or flight control. It does not read or write NVS.

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
| Serial | UART0 via existing USB bridge; newline-delimited JSON, no commands accepted |
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

## Primary technical references

- [TDK MPU-6500 register map, RM-MPU-6500A-00 rev 2.1](https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6500-Register-Map2.pdf): identity, configuration and burst register addresses.
- [TDK MPU-6500 product specification rev 1.3](https://invensense.tdk.com/wp-content/uploads/2020/06/PS-MPU-6500A-01-v1.3.pdf): SPI interface and sensitivity.
- [ESP-IDF pinned ADC example](https://github.com/espressif/esp-idf/blob/fff9895c82d744c7237be8847347bdd1b07c6643/examples/peripherals/adc/oneshot_read/main/oneshot_read_main.c) and component headers: native driver APIs.
- [Espressif ESP32 ADC range](https://docs.espressif.com/projects/esp-idf/en/v4.4.8/esp32/api-reference/peripherals/adc.html): conservative 12 dB characterized range.

Hardware facts are recorded in the private reference BOM/schematic and original
USB evidence. Their document identity does not establish this unit's PCB continuity.
