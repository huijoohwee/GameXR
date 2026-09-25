// SPDX-License-Identifier: MIT
#pragma once
#include "esp_err.h"
#include "mpu6500.h"
#include "telemetry.h"

esp_err_t inhibit_motor_gates(void);
imu_status_t sensors_init_imu(uint8_t *identity);
imu_status_t sensors_read_imu(imu_sample_t *out);
esp_err_t sensors_init_battery(void);
battery_sample_t sensors_read_battery(void);
