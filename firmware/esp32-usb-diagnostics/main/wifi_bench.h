// SPDX-License-Identifier: MIT
#pragma once
#include "esp_http_server.h"
#include <stdbool.h>
#include <stdint.h>
bool wifi_bench_init(void);
void wifi_bench_tick(int64_t now);
void wifi_bench_imu(bool valid, const float gyro[3], int64_t now);
esp_err_t wifi_bench_request(httpd_req_t *req);
bool wifi_bench_suspend(bool value);
