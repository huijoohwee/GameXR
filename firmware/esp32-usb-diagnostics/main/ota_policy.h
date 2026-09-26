// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define OTA_IMAGE_LIMIT 0x140000u
#define OTA_IMAGE_MIN 1024u
#define OTA_UPLOAD_MS 90000
bool ota_hex_digest(const char *text, uint8_t out[32]);
void ota_hex_format(const uint8_t bytes[32], char out[65]);
bool ota_version_supported(const char *version, size_t capacity);
bool ota_image_prefix(const uint8_t *bytes, size_t size);
typedef struct { unsigned healthy; bool pending, verified, failed; } ota_health_t;
typedef enum { OTA_HEALTH_WAIT, OTA_HEALTH_CONFIRM, OTA_HEALTH_ROLLBACK } ota_health_action_t;
ota_health_action_t ota_health_step(ota_health_t *h, bool healthy, bool network_ok,
                                  bool boot_verified, bool observed, int64_t uptime_ms);
