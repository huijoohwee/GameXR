// SPDX-License-Identifier: MIT
#include "imu_window.h"
#include <string.h>

void imu_window_push(imu_window_t *w, const char *line, uint32_t seq, int64_t at)
{
    size_t n = 0;
    while (n < IMU_WINDOW_LINE && line[n]) n++;
    if (n == 0 || n == IMU_WINDOW_LINE) { w->count = 0; return; }
    if (w->count && (w->last == UINT32_MAX || seq != w->last + 1)) w->count = 0;
    imu_window_row_t *row = &w->rows[seq % IMU_WINDOW_SLOTS];
    row->seq = seq; row->at = at; memcpy(row->line, line, n + 1);
    w->last = seq;
    if (w->count < IMU_WINDOW_SLOTS) w->count++;
}

imu_window_status_t imu_window_read(const imu_window_t *w, bool initial, uint32_t after,
                                  int64_t now, imu_window_batch_t *out)
{
    out->count = 0; out->age = 0;
    if (!w->count) return WINDOW_EMPTY;
    const int64_t latest_age = now - w->rows[w->last % IMU_WINDOW_SLOTS].at;
    if (latest_age < 0 || latest_age >= 1500) return WINDOW_STALE;
    if (!initial && (after > w->last || (uint64_t)after + w->count < w->last)) return WINDOW_GAP;
    const uint64_t start = initial ? w->last : (uint64_t)after + 1;
    for (uint64_t seq = start; seq <= w->last && out->count < IMU_WINDOW_BATCH; seq++)
        out->rows[out->count++] = w->rows[seq % IMU_WINDOW_SLOTS];
    out->age = out->count ? now - out->rows[out->count - 1].at : latest_age;
    return out->age < 0 || out->age >= 1500 ? WINDOW_STALE : WINDOW_OK;
}

static bool number(const char **s, uint32_t *out)
{
    const char *p = *s; uint64_t n = 0;
    if (*p < '0' || *p > '9') return false;
    do { n = n * 10 + (unsigned)(*p++ - '0'); if (n > UINT32_MAX) return false; }
    while (*p >= '0' && *p <= '9');
    *s = p; *out = (uint32_t)n; return true;
}
bool imu_window_cursor(const char *query, uint32_t *session, uint32_t *after)
{
    if (strncmp(query, "session=", 8)) return false;
    query += 8;
    if (!number(&query, session) || strncmp(query, "&after=", 7)) return false;
    query += 7;
    return number(&query, after) && !*query;
}
