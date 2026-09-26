// SPDX-License-Identifier: MIT
#include "imu_window.h"
#include <assert.h>
#include <string.h>
static imu_window_t window;
static imu_window_batch_t batch;
int main(void)
{
    assert(imu_window_read(&window, true, 0, 0, &batch) == WINDOW_EMPTY);
    for (unsigned i = 0; i < 40; i++) imu_window_push(&window, "{}", i, i * 100);
    assert(window.count == 32);
    assert(imu_window_read(&window, true, 0, 3910, &batch) == WINDOW_OK);
    assert(batch.count == 1 && batch.rows[0].seq == 39 && batch.age == 10);
    assert(imu_window_read(&window, false, 30, 3910, &batch) == WINDOW_OK);
    assert(batch.count == 8 && batch.rows[0].seq == 31 && batch.rows[7].seq == 38 && batch.age == 110);
    assert(imu_window_read(&window, false, 39, 3910, &batch) == WINDOW_OK && !batch.count);
    assert(imu_window_read(&window, false, 6, 3910, &batch) == WINDOW_GAP);
    assert(imu_window_read(&window, false, 40, 3910, &batch) == WINDOW_GAP);
    assert(imu_window_read(&window, false, 7, 3910, &batch) == WINDOW_STALE);
    assert(imu_window_read(&window, true, 0, 5400, &batch) == WINDOW_STALE);
    assert(imu_window_read(&window, true, 0, 3899, &batch) == WINDOW_STALE);
    imu_window_push(&window, "{}", 45, 4500);
    assert(window.count == 1);
    assert(imu_window_read(&window, false, 39, 4500, &batch) == WINDOW_GAP);
    imu_window_push(&window, "{}", UINT32_MAX, 5000);
    assert(imu_window_read(&window, false, UINT32_MAX, 5000, &batch) == WINDOW_OK && !batch.count);
    imu_window_push(&window, "{}", 0, 5100);
    assert(window.count == 1);
    assert(imu_window_read(&window, false, UINT32_MAX, 5100, &batch) == WINDOW_GAP);
    char oversized[IMU_WINDOW_LINE + 1]; memset(oversized, 'a', sizeof(oversized)); oversized[sizeof(oversized)-1] = 0;
    imu_window_push(&window, oversized, 1, 5200);
    assert(imu_window_read(&window, true, 0, 5200, &batch) == WINDOW_EMPTY);
    uint32_t session, after;
    assert(imu_window_cursor("session=42&after=4294967295", &session, &after));
    assert(session == 42 && after == UINT32_MAX);
    const char *bad[] = {"", "session=-1&after=0", "session=1&after=4294967296", "session=4294967296&after=1",
        "session=1&after=1&extra=2", "session=1&after=", "after=1&session=2", "session=1x&after=2"};
    for (unsigned i = 0; i < sizeof(bad)/sizeof(bad[0]); i++) assert(!imu_window_cursor(bad[i], &session, &after));
}
