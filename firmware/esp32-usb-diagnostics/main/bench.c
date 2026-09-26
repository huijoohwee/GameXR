// SPDX-License-Identifier: MIT
// Diagnostic calculations only: this module has no hardware/PWM dependency.
#include "bench.h"
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static void zero(bench_t *b) {
    b->active = false;
    memset(b->target, 0, sizeof(b->target));
    memset(b->virtual_motors, 0, sizeof(b->virtual_motors));
}
void bench_fault(bench_t *b, const char *reason) {
    zero(b); b->linked = false; b->status = reason; b->pending = true;
}
void bench_init(bench_t *b, uint32_t seed) {
    memset(b, 0, sizeof(*b)); b->nonce = seed;
    b->command_at = -1000; b->reply_at = -1000; b->status = "idle";
}
static bool healthy(const bench_t *b, int64_t now) {
    return b->imu_ok && now >= b->imu_at && now - b->imu_at < 200;
}
static int bounded(float n) {
    return n < 0 ? 0 : n > 200 ? 200 : (int)lroundf(n);
}
static void calculate(bench_t *b) {
    if (!b->active) return;
    // Untuned proportional rate damping, native sensor frame. No attitude estimator.
    float e[3];
    for (int i = 0; i < 3; i++)
        e[i] = fmaxf(-100, fminf(100, 40 * (b->target[i+1]/1000.0f - b->gyro[i])));
    float t = b->target[0], r = e[0], p = e[1], y = e[2];
    // Logical X mixer slots only; physical order and rotation directions unverified.
    b->virtual_motors[0] = bounded(t + r - p + y);
    b->virtual_motors[1] = bounded(t - r - p - y);
    b->virtual_motors[2] = bounded(t + r + p - y);
    b->virtual_motors[3] = bounded(t - r + p + y);
    if (b->target[0] == 0) memset(b->virtual_motors, 0, sizeof(b->virtual_motors));
}
void bench_imu(bench_t *b, bool valid, const float gyro[3], int64_t now) {
    b->imu_ok = valid;
    for (int i = 0; i < 3; i++) {
        b->imu_ok &= isfinite(gyro[i]) && fabsf(gyro[i]) <= 35;
        b->gyro[i] = gyro[i];
    }
    b->imu_at = now;
    if (b->active && !b->imu_ok) bench_fault(b, "imu_invalid");
    else calculate(b);
}
void bench_tick(bench_t *b, int64_t now) {
    if (b->used && (now < b->frame_at || now - b->frame_at >= 100)) {
        b->used = 0; b->dropping = true; bench_fault(b, "partial_timeout");
    }
    if (b->linked && (now < b->command_at || now >= b->deadline)) bench_fault(b, "expired");
    if (b->active && !healthy(b, now)) bench_fault(b, "imu_stale");
}
static bool number(const char **cursor, int64_t *out) {
    const char *p = *cursor; bool negative = *p == '-';
    if (negative) p++;
    if (*p < '0' || *p > '9') return false;
    int64_t value = 0;
    do {
        value = value * 10 + *p++ - '0';
        if (value > UINT32_MAX) return false;
    } while (*p >= '0' && *p <= '9');
    if (*p && *p != ' ') return false;
    *out = negative ? -value : value; *cursor = p; return true;
}
static void command(bench_t *b, int64_t now) {
    // HELLO and STOP always zero state; their replies still share the TX rate cap.
    if (!strcmp(b->line, "GXR1 HELLO")) {
        zero(b); b->nonce++; if (!b->nonce) b->nonce++;
        b->session = b->nonce; b->seq = 0; b->linked = true;
        b->command_at = now; b->deadline = now + BENCH_LEASE_MS;
        b->status = "ready"; b->pending = true; return;
    }
    if (!strcmp(b->line, "GXR1 STOP")) { bench_fault(b, "stopped"); return; }
    if (now < b->command_at || now - b->command_at < 50) { bench_fault(b, "rate_limited"); return; }
    b->command_at = now;
    if (strncmp(b->line, "GXR1 SET ", 9)) { bench_fault(b, "malformed"); return; }
    int64_t n[6]; const char *p = b->line + 9;
    for (int i = 0; i < 6; i++) {
        if (!number(&p, &n[i]) || (i < 5 && *p++ != ' ')) { bench_fault(b, "malformed"); return; }
    }
    if (*p) { bench_fault(b, "malformed"); return; }
    if (!b->linked || n[0] < 1 || (uint64_t)n[0] != b->session) { bench_fault(b, "session"); return; }
    if (n[1] < 1 || n[1] > INT32_MAX || (uint64_t)n[1] <= b->seq) { bench_fault(b, "sequence"); return; }
    if (n[2] < 0 || n[2] > 200) { bench_fault(b, "range"); return; }
    for (int i = 3; i < 6; i++) if (n[i] < -1000 || n[i] > 1000) { bench_fault(b, "range"); return; }
    if (!healthy(b, now)) { bench_fault(b, "imu_stale"); return; }
    b->seq = (uint32_t)n[1];
    for (int i = 0; i < 4; i++) b->target[i] = (int)n[i+2];
    b->active = true; b->deadline = now + BENCH_LEASE_MS;
    b->status = "accepted"; b->pending = true; calculate(b);
}
void bench_byte(bench_t *b, unsigned char byte, int64_t now) {
    bench_tick(b, now);
    if (b->dropping) { if (byte == '\n') b->dropping = false; return; }
    if (byte == '\n') {
        if (!b->used) return;
        b->line[b->used] = 0; b->used = 0; command(b, now); return;
    }
    if (byte < 32 || byte > 126 || b->used == sizeof(b->line)-1) {
        b->used = 0; b->dropping = true; bench_fault(b, "framing"); return;
    }
    if (!b->used) b->frame_at = now;
    b->line[b->used++] = (char)byte;
}
bool bench_reply(bench_t *b, char *out, size_t cap, int64_t now) {
    if (!b->pending || now < b->reply_at || now-b->reply_at < 50) return false;
    int n = snprintf(out, cap, "{\"profile\":\"gamexr.usb-bench/v1\",\"type\":\"ack\","
        "\"session\":%" PRIu32 ",\"seq\":%" PRIu32 ",\"status\":\"%s\",\"active\":%s,"
        "\"lease_ms\":250,\"outputs_enabled\":false,\"motor_outputs\":[0,0,0,0],"
        "\"virtual_motors\":[%d,%d,%d,%d]}", b->session, b->seq, b->status,
        b->active ? "true" : "false", b->virtual_motors[0], b->virtual_motors[1],
        b->virtual_motors[2], b->virtual_motors[3]);
    if (n < 0 || (size_t)n >= cap) return false;
    b->pending = false; b->reply_at = now; return true;
}
