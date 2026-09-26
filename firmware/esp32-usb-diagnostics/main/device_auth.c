// SPDX-License-Identifier: MIT
#include "device_auth.h"
#include <string.h>
#if DEVICE_TLS_AVAILABLE
extern const char auth_start[] asm("_binary_control_key_start");
extern const char auth_end[] asm("_binary_control_key_end");
#endif
bool device_authorized(httpd_req_t *req, bool require_origin) {
#if DEVICE_TLS_AVAILABLE
    char host[40], origin[48], key[65];
    if (auth_end-auth_start != 64 ||
        httpd_req_get_hdr_value_str(req,"Host",host,sizeof(host)) != ESP_OK ||
        strcmp(host,"192.168.4.1:8443") ||
        httpd_req_get_hdr_value_len(req,"X-GXR-Key") != 64 ||
        httpd_req_get_hdr_value_str(req,"X-GXR-Key",key,sizeof(key)) != ESP_OK) return false;
    if (require_origin || httpd_req_get_hdr_value_len(req,"Origin")) {
        if (httpd_req_get_hdr_value_str(req,"Origin",origin,sizeof(origin)) != ESP_OK ||
            strcmp(origin,"https://192.168.4.1:8443")) return false;
    }
    unsigned difference=0;
    for (unsigned i=0;i<64;i++) difference |= (unsigned char)key[i] ^ (unsigned char)auth_start[i];
    return difference == 0;
#else
    (void)req; (void)require_origin; return false;
#endif
}
