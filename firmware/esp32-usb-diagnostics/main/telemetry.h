// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "mpu6500.h"

typedef enum { BAT_OK, BAT_IO_ERROR, BAT_NO_CALIBRATION, BAT_OUT_OF_RANGE } battery_status_t;
typedef struct { battery_status_t status; int raw, adc_mv; } battery_sample_t;
// Returns false on truncation; callers must not transmit a partial JSON frame.
bool format_sample(char *out, size_t capacity, uint32_t sequence, int64_t uptime_ms,
                   imu_status_t imu_status, const imu_sample_t *imu,
                   const battery_sample_t *battery);
battery_status_t battery_classify(int raw, bool calibrated, int adc_mv, bool saturated);
int battery_mv_from_adc(int adc_mv);
