// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_http_server.h"
void ota_guard_init(void);
void ota_guard_tick(bool healthy, bool network_ok, int64_t now);
bool ota_guard_acquire(void);
void ota_guard_release(void);
bool ota_guard_busy(void);
esp_err_t ota_schedule_restart(void);
esp_err_t ota_status_request(httpd_req_t *req);
esp_err_t ota_upload_request(httpd_req_t *req);
esp_err_t ota_recover_request(httpd_req_t *req);
