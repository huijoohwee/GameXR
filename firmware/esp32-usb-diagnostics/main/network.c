// SPDX-License-Identifier: MIT
#include "network.h"
#include "wifi_bench.h"
#include "ota_guard.h"
#include "imu_window.h"
#include "cockpit_assets.h"
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_https_server.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"

#define SSID "XW_Drone_WiFi"
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static char latest[640];
static imu_window_t imu_window;
static int64_t sampled_at;
static uint32_t session;
static httpd_handle_t plain, secure;
extern const uint8_t page_start[] asm("_binary_device_page_start");
extern const uint8_t page_end[] asm("_binary_device_page_end");
extern const uint8_t js_start[] asm("_binary_device_script_start");
extern const uint8_t js_end[] asm("_binary_device_script_end");
#if DEVICE_TLS_AVAILABLE
extern const uint8_t cert_start[] asm("_binary_device_cert_start");
extern const uint8_t cert_end[] asm("_binary_device_cert_end");
extern const uint8_t key_start[] asm("_binary_device_key_start");
extern const uint8_t key_end[] asm("_binary_device_key_end");
extern const uint8_t ca_start[] asm("_binary_device_ca_start");
extern const uint8_t ca_end[] asm("_binary_device_ca_end");
#endif

void network_publish(const char *line, uint32_t sequence, int64_t ms)
{
    const size_t length = strnlen(line, sizeof(latest));
    portENTER_CRITICAL(&lock);
    if (length < sizeof(latest)) { memcpy(latest, line, length + 1); sampled_at = ms; }
    else { latest[0] = 0; sampled_at = 0; }
    imu_window_push(&imu_window, line, sequence, ms);
    portEXIT_CRITICAL(&lock);
}
static esp_err_t get_window(httpd_req_t *req)
{
    const char *query = strchr(req->uri, '?');
    const bool initial = !query;
    uint32_t requested_session = 0, after = 0;
    if (query && !imu_window_cursor(query + 1, &requested_session, &after))
        return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid sample cursor");
    if (!initial && requested_session != session) {
        httpd_resp_set_status(req, "409 Conflict"); return httpd_resp_sendstr(req, "Device restarted; restart capture");
    }
    imu_window_batch_t *batch = malloc(sizeof(*batch));
    if (!batch) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Capture memory unavailable");
    const int64_t now = esp_timer_get_time()/1000;
    portENTER_CRITICAL(&lock);
    const imu_window_status_t status = imu_window_read(&imu_window, initial, after, now, batch);
    portEXIT_CRITICAL(&lock);
    if (status != WINDOW_OK) {
        free(batch);
        httpd_resp_set_status(req, status == WINDOW_GAP ? "409 Conflict" : "503 Service Unavailable");
        return httpd_resp_sendstr(req, status == WINDOW_GAP ? "Sample gap; restart capture" : "No fresh capture window");
    }
    char header[200];
    const int n = snprintf(header, sizeof(header), "{\"schema\":\"gamexr.imu-window/v1\",\"session\":%" PRIu32
        ",\"age_ms\":%" PRId64 ",\"actuation_available\":false,\"samples\":[", session, batch->age);
    httpd_resp_set_type(req, "application/json");
    esp_err_t error = httpd_resp_send_chunk(req, header, n);
    for (size_t i = 0; i < batch->count && error == ESP_OK; i++) {
        if (i) error = httpd_resp_send_chunk(req, ",", 1);
        if (error == ESP_OK) error = httpd_resp_send_chunk(req, batch->rows[i].line, strlen(batch->rows[i].line));
    }
    free(batch);
    if (error == ESP_OK) error = httpd_resp_send_chunk(req, "]}", 2);
    if (error == ESP_OK) error = httpd_resp_send_chunk(req, NULL, 0);
    return error;
}
static esp_err_t get(httpd_req_t *req)
{
    char host[64];
    if (httpd_req_get_hdr_value_str(req, "Host", host, sizeof(host)) != ESP_OK
        || (strcmp(host, "192.168.4.1:8080") && strcmp(host, "192.168.4.1:8443")))
        return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Wrong device address");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "X-Content-Type-Options", "nosniff");
    httpd_resp_set_hdr(req, "Referrer-Policy", "no-referrer");
    httpd_resp_set_hdr(req, "Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    httpd_resp_set_hdr(req, "Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
    if (!strcmp(req->uri, "/")) {
        httpd_resp_set_status(req,"302 Found");
        httpd_resp_set_hdr(req,"Location","https://192.168.4.1:8443/gamexr/");
        return httpd_resp_sendstr(req,"");
    }
    if (!strncmp(req->uri,"/gamexr/",8)) return cockpit_asset(req);
    if (!strncmp(req->uri, "/api/imu-window", 15) && (req->uri[15] == 0 || req->uri[15] == '?')) return get_window(req);
    if (!strcmp(req->uri, "/api/telemetry")) {
        char line[640], body[850]; int64_t when;
        portENTER_CRITICAL(&lock);
        memcpy(line, latest, sizeof(line)); when = sampled_at;
        portEXIT_CRITICAL(&lock);
        int64_t age = esp_timer_get_time()/1000 - when;
        if (!line[0] || age < 0 || age >= 1500) {
            httpd_resp_set_status(req, "503 Service Unavailable");
            return httpd_resp_sendstr(req, "No fresh IMU sample");
        }
        int n = snprintf(body, sizeof(body), "{\"schema\":\"gamexr.direct-wifi/v1\",\"session\":%" PRIu32 ",\"age_ms\":%" PRId64 ",\"actuation_available\":false,\"sample\":%s}", session, age, line);
        if (n < 0 || (size_t)n >= sizeof(body)) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Telemetry overflow");
        httpd_resp_set_type(req, "application/json");
        return httpd_resp_send(req, body, n);
    }
    if (!strcmp(req->uri, "/device.js")) {
        httpd_resp_set_type(req, "text/javascript");
        return httpd_resp_send(req, (const char *)js_start, js_end-js_start);
    }
#if DEVICE_TLS_AVAILABLE
    if (!strcmp(req->uri, "/device-ca.cer")) {
        httpd_resp_set_type(req, "application/pkix-cert");
        httpd_resp_set_hdr(req, "Content-Disposition", "attachment; filename=GameXR-drone-local.cer");
        return httpd_resp_send(req, (const char *)ca_start, ca_end-ca_start);
    }
#endif
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, (const char *)page_start, page_end-page_start);
}
static esp_err_t routes(httpd_handle_t server)
{
    const char *paths[] = {"/", "/diagnostics", "/gamexr/*", "/device.js", "/api/telemetry", "/api/imu-window*"
#if DEVICE_TLS_AVAILABLE
        , "/device-ca.cer"
#endif
    };
    for (unsigned i = 0; i < sizeof(paths)/sizeof(paths[0]); i++) {
        const httpd_uri_t uri = {.uri=paths[i], .method=HTTP_GET, .handler=get};
        esp_err_t error = httpd_register_uri_handler(server, &uri);
        if (error != ESP_OK) return error;
    }
    return ESP_OK;
}
#define TRY(call) do { error = (call); if (error != ESP_OK) goto failed; } while (0)
esp_err_t network_start(void)
{
    esp_err_t error; bool started = false, initialized = false;
    session = esp_random();
    if (!wifi_bench_init()) return ESP_ERR_NO_MEM;
    TRY(esp_netif_init()); TRY(esp_event_loop_create_default());
    esp_netif_t *ap = esp_netif_create_default_wifi_ap();
    if (!ap) { error = ESP_ERR_NO_MEM; goto failed; }
    esp_netif_ip_info_t ip = {0};
    TRY(esp_netif_str_to_ip4("192.168.4.1", &ip.ip)); ip.gw = ip.ip;
    TRY(esp_netif_str_to_ip4("255.255.255.0", &ip.netmask));
    TRY(esp_netif_dhcps_stop(ap)); TRY(esp_netif_set_ip_info(ap, &ip)); TRY(esp_netif_dhcps_start(ap));
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT(); init.nvs_enable = 0;
    TRY(esp_wifi_init(&init)); initialized = true;
    TRY(esp_wifi_set_storage(WIFI_STORAGE_RAM)); TRY(esp_wifi_set_mode(WIFI_MODE_AP));
    wifi_config_t wifi = {.ap={.ssid=SSID, .ssid_len=sizeof(SSID)-1, .password="12345678",
        .channel=6, .max_connection=2, .authmode=WIFI_AUTH_WPA2_PSK}};
    TRY(esp_wifi_set_config(WIFI_IF_AP, &wifi)); TRY(esp_wifi_start()); started = true;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.uri_match_fn=httpd_uri_match_wildcard; config.server_port=8080; config.max_open_sockets=3; config.lru_purge_enable=true;
    config.recv_wait_timeout=3; config.send_wait_timeout=3;
    TRY(httpd_start(&plain, &config)); TRY(routes(plain));
#if DEVICE_TLS_AVAILABLE
    httpd_ssl_config_t tls = HTTPD_SSL_CONFIG_DEFAULT();
    tls.port_secure=8443; tls.httpd.ctrl_port=32769; tls.httpd.max_open_sockets=3;
    tls.httpd.uri_match_fn=httpd_uri_match_wildcard; tls.httpd.max_uri_handlers=12;
    tls.httpd.lru_purge_enable=true; tls.httpd.recv_wait_timeout=3; tls.httpd.send_wait_timeout=3;
    tls.servercert=cert_start; tls.servercert_len=cert_end-cert_start;
    tls.prvtkey_pem=key_start; tls.prvtkey_len=key_end-key_start;
    TRY(httpd_ssl_start(&secure, &tls)); TRY(routes(secure));
    const httpd_uri_t command={.uri="/api/bench",.method=HTTP_POST,.handler=wifi_bench_request};
    TRY(httpd_register_uri_handler(secure,&command));
    const httpd_uri_t ota_status={.uri="/api/ota",.method=HTTP_GET,.handler=ota_status_request};
    const httpd_uri_t ota_upload={.uri="/api/ota",.method=HTTP_POST,.handler=ota_upload_request};
    const httpd_uri_t ota_recover={.uri="/api/ota/recover",.method=HTTP_POST,.handler=ota_recover_request};
    TRY(httpd_register_uri_handler(secure,&ota_status)); TRY(httpd_register_uri_handler(secure,&ota_upload));
    TRY(httpd_register_uri_handler(secure,&ota_recover));
#endif
    printf("{\"profile\":\"gamexr.direct-wifi/v1\",\"type\":\"network\",\"ssid\":\"%s\",\"http_port\":8080,\"https_port\":%d,\"actuation_available\":false}\n", SSID, DEVICE_TLS_AVAILABLE ? 8443 : 0);
    return ESP_OK;
failed:
    if (secure) { httpd_ssl_stop(secure); secure = NULL; }
    if (plain) { httpd_stop(plain); plain = NULL; }
    if (started) esp_wifi_stop();
    if (initialized) esp_wifi_deinit();
    return error;
}
