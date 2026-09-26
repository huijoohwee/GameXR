// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define BENCH_LEASE_MS 250
#define BENCH_LINE_CAP 96
typedef struct {
    uint32_t nonce, session, seq;
    int64_t deadline, imu_at, frame_at, command_at, reply_at;
    bool linked, active, imu_ok, dropping, pending;
    float gyro[3];
    int target[4], virtual_motors[4];
    char line[BENCH_LINE_CAP];
    size_t used;
    const char *status;
} bench_t;

void bench_init(bench_t *b, uint32_t seed);
void bench_imu(bench_t *b, bool valid, const float gyro[3], int64_t now);
void bench_fault(bench_t *b, const char *reason);
void bench_tick(bench_t *b, int64_t now);
void bench_byte(bench_t *b, unsigned char byte, int64_t now);
bool bench_reply(bench_t *b, char *out, size_t cap, int64_t now);
