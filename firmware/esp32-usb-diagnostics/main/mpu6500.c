// SPDX-License-Identifier: MIT
// Register facts: TDK RM-MPU-6500A-00 rev 2.1; no vendor flight code used.
#include "mpu6500.h"
#include <string.h>

static int16_t signed_be(const uint8_t *p)
{
    const int value = (int)p[0] * 256 + p[1];
    return (int16_t)(value >= 32768 ? value - 65536 : value);
}

imu_status_t mpu6500_init(const imu_bus_t *bus, uint8_t *identity)
{
    *identity = 0;
    bus->delay_ms(100);
    if (bus->read(bus->context, 0x75, identity, 1)) return IMU_IO_ERROR;
    // Never reset/configure an unidentified peripheral.
    if (*identity != 0x70) return IMU_WRONG_ID;
    if (bus->write(bus->context, 0x6b, 0x80)) return IMU_IO_ERROR;
    bus->delay_ms(100);
    // I2C_IF_DIS is a self-clearing trigger: do not require it in readback.
    if (bus->write(bus->context, 0x6a, 0x10)) return IMU_IO_ERROR;
    const uint8_t config[][2] = {
        {0x6b, 0x01}, // wake, auto-select best clock
        {0x6c, 0x00}, // enable all six axes
        {0x23, 0x00}, // FIFO disabled
        {0x1a, 0x03}, // gyro DLPF; 1 kHz base rate
        {0x19, 0x09}, // divide base rate by ten: 100 Hz
        {0x1b, 0x08}, // gyro +/-500 degrees/s, 65.5 LSB/(degree/s)
        {0x1c, 0x08}, // accelerometer +/-4g, 8192 LSB/g
        {0x1d, 0x03}, // accelerometer DLPF
        {0x37, 0x00}, // INT_STATUS read clears data-ready flag
        {0x38, 0x01}, // enable data-ready status, no GPIO interrupt wired
    };
    for (size_t i = 0; i < sizeof(config) / sizeof(config[0]); ++i) {
        uint8_t actual = 0;
        if (bus->write(bus->context, config[i][0], config[i][1]) ||
            bus->read(bus->context, config[i][0], &actual, 1)) return IMU_IO_ERROR;
        if (actual != config[i][1]) return IMU_CONFIG_ERROR;
    }
    bus->delay_ms(100);
    return IMU_OK;
}

imu_status_t mpu6500_sample(const imu_bus_t *bus, imu_sample_t *out)
{
    memset(out, 0, sizeof(*out)); // failed/stale samples are never retained
    uint8_t id = 0, ready = 0, data[14];
    if (bus->read(bus->context, 0x75, &id, 1)) return IMU_IO_ERROR;
    if (id != 0x70) return IMU_WRONG_ID;
    if (bus->read(bus->context, 0x3a, &ready, 1)) return IMU_IO_ERROR;
    if (!(ready & 1)) return IMU_NOT_READY;
    // One burst provides accel, temperature (unused), then gyro.
    if (bus->read(bus->context, 0x3b, data, sizeof(data))) return IMU_IO_ERROR;
    for (int axis = 0; axis < 3; ++axis) {
        out->accel[axis] = signed_be(&data[axis * 2]);
        out->gyro[axis] = signed_be(&data[8 + axis * 2]);
    }
    return IMU_OK;
}

const char *imu_status_name(imu_status_t status)
{
    switch (status) {
    case IMU_OK: return "ok";
    case IMU_NOT_READY: return "not_ready";
    case IMU_IO_ERROR: return "io_error";
    case IMU_WRONG_ID: return "wrong_id";
    case IMU_CONFIG_ERROR: return "config_error";
    default: return "invalid_status";
    }
}
