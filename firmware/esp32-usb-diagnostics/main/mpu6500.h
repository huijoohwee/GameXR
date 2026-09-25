// SPDX-License-Identifier: MIT
#pragma once
#include <stddef.h>
#include <stdint.h>

typedef enum { IMU_OK, IMU_NOT_READY, IMU_IO_ERROR, IMU_WRONG_ID, IMU_CONFIG_ERROR } imu_status_t;
typedef struct {
    int (*read)(void *context, uint8_t reg, uint8_t *out, size_t length);
    int (*write)(void *context, uint8_t reg, uint8_t value);
    void (*delay_ms)(unsigned ms);
    void *context;
} imu_bus_t;
typedef struct { int16_t accel[3], gyro[3]; } imu_sample_t;
imu_status_t mpu6500_init(const imu_bus_t *bus, uint8_t *identity);
imu_status_t mpu6500_sample(const imu_bus_t *bus, imu_sample_t *out);
const char *imu_status_name(imu_status_t status);
