// SPDX-License-Identifier: MIT
#include "telemetry.h"
#include "board.h"
#include <inttypes.h>
#include <stdio.h>

battery_status_t battery_classify(int raw, bool calibrated, int adc_mv, bool saturated)
{
    if (raw < 0 || raw > 4095) return BAT_IO_ERROR;
    if (saturated || raw == 4095) return BAT_OUT_OF_RANGE;
    if (!calibrated) return BAT_NO_CALIBRATION;
    // Conservative ESP32 12 dB characterized range; never extrapolate battery voltage.
    if (adc_mv < 150 || adc_mv > 2450) return BAT_OUT_OF_RANGE;
    return BAT_OK;
}

int battery_mv_from_adc(int adc_mv) { return (adc_mv * 43 + 16) / 33; }

bool format_sample(char *out, size_t capacity, uint32_t sequence, int64_t uptime_ms,
                   imu_status_t status, const imu_sample_t *imu, const battery_sample_t *battery)
{
    char accel[80] = "null", gyro[80] = "null", raw[20] = "null", adc[20] = "null", mv[20] = "null";
    if (status == IMU_OK) {
        const double a = 9.80665 / 8192.0, g = 0.017453292519943295 / 65.5;
        snprintf(accel, sizeof(accel), "[%.6f,%.6f,%.6f]", imu->accel[0]*a, imu->accel[1]*a, imu->accel[2]*a);
        snprintf(gyro, sizeof(gyro), "[%.6f,%.6f,%.6f]", imu->gyro[0]*g, imu->gyro[1]*g, imu->gyro[2]*g);
    }
    const char *battery_status;
    switch (battery->status) {
    case BAT_OK: battery_status = "ok"; break;
    case BAT_IO_ERROR: battery_status = "io_error"; break;
    case BAT_NO_CALIBRATION: battery_status = "no_efuse_calibration"; break;
    case BAT_OUT_OF_RANGE: battery_status = "out_of_range"; break;
    default: battery_status = "invalid_status"; break;
    }
    if (battery->status != BAT_IO_ERROR && battery->raw >= 0)
        snprintf(raw, sizeof(raw), "%d", battery->raw);
    if (battery->adc_mv >= 0 && battery->status != BAT_IO_ERROR)
        snprintf(adc, sizeof(adc), "%d", battery->adc_mv);
    if (battery->status == BAT_OK)
        snprintf(mv, sizeof(mv), "%d", battery_mv_from_adc(battery->adc_mv));
    int n = snprintf(out, capacity,
        "{\"profile\":\"%s\",\"type\":\"sample\",\"seq\":%" PRIu32 ",\"uptime_ms\":%" PRId64
        ",\"motor_gate_command\":\"low_held\",\"imu\":{\"status\":\"%s\",\"frame\":\"sensor\","
        "\"accel_m_s2\":%s,\"gyro_rad_s\":%s},\"battery\":{\"status\":\"%s\",\"raw\":%s,"
        "\"adc_mv\":%s,\"battery_mv\":%s}}",
        TELEMETRY_PROFILE, sequence, uptime_ms, imu_status_name(status), accel, gyro, battery_status, raw, adc, mv);
    if (n < 0 || (size_t)n >= capacity) { if (capacity) out[0] = '\0'; return false; }
    return true;
}
