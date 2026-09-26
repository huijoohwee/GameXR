// SPDX-License-Identifier: MIT
#pragma once
#include <stdint.h>
#include "esp_err.h"
esp_err_t network_start(void);
void network_publish(const char *line, uint32_t sequence, int64_t sampled_ms);
