// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define IMU_WINDOW_SLOTS 32
#define IMU_WINDOW_BATCH 8
#define IMU_WINDOW_LINE 640
typedef struct { uint32_t seq; int64_t at; char line[IMU_WINDOW_LINE]; } imu_window_row_t;
typedef struct { imu_window_row_t rows[IMU_WINDOW_SLOTS]; size_t count; uint32_t last; } imu_window_t;
typedef struct { imu_window_row_t rows[IMU_WINDOW_BATCH]; size_t count; int64_t age; } imu_window_batch_t;
typedef enum { WINDOW_OK, WINDOW_EMPTY, WINDOW_GAP, WINDOW_STALE } imu_window_status_t;
// Caller owns synchronization; no allocation, parsing, network or device writes here.
void imu_window_push(imu_window_t *window, const char *line, uint32_t seq, int64_t at);
imu_window_status_t imu_window_read(const imu_window_t *window, bool initial, uint32_t after,
                                  int64_t now, imu_window_batch_t *batch);
bool imu_window_cursor(const char *query, uint32_t *session, uint32_t *after);
