// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include "esp_http_server.h"
bool device_authorized(httpd_req_t *req, bool require_origin);
