// SPDX-License-Identifier: MIT
#pragma once
#include "bench.h"
#include "esp_err.h"
esp_err_t bench_uart_init(void);
void bench_uart_poll(bench_t *bench, int64_t now);
