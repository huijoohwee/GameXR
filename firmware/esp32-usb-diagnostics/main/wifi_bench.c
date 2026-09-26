// SPDX-License-Identifier: MIT
// Separate non-actuating model. Lock covers RAM calculations only, never socket IO.
#include "wifi_bench.h"
#include "bench.h"
#include "device_auth.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <stdio.h>
#include <string.h>
static SemaphoreHandle_t mutex;
static bench_t model;
static bool maintenance;
bool wifi_bench_init(void) {
    mutex = xSemaphoreCreateMutex();
    bench_init(&model, esp_random());
    return mutex != NULL;
}
void wifi_bench_tick(int64_t now) {
    if (mutex && xSemaphoreTake(mutex, 0)) {
        bench_tick(&model, now); xSemaphoreGive(mutex);
    }
}
void wifi_bench_imu(bool valid, const float gyro[3], int64_t now) {
    if (mutex && xSemaphoreTake(mutex, pdMS_TO_TICKS(10))) {
        bench_imu(&model, valid, gyro, now); xSemaphoreGive(mutex);
    }
}
bool wifi_bench_suspend(bool value) {
    if (!mutex || !xSemaphoreTake(mutex,pdMS_TO_TICKS(100))) return false;
    maintenance=value; bench_init(&model,esp_random()); xSemaphoreGive(mutex); return true;
}
static esp_err_t unavailable(httpd_req_t *req) {
    httpd_resp_set_status(req,"503 Service Unavailable");
    return httpd_resp_sendstr(req,"Control unavailable");
}
esp_err_t wifi_bench_request(httpd_req_t *req) {
    if (!device_authorized(req, true)) return httpd_resp_send_err(req,HTTPD_403_FORBIDDEN,"Pairing required");
    if (!mutex) return unavailable(req);
    if (req->content_len < 1 || req->content_len >= BENCH_LINE_CAP)
        return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid command length");
    char command[BENCH_LINE_CAP], body[512]; size_t used=0;
    const int64_t started=esp_timer_get_time()/1000;
    while (used < req->content_len) {
        int n=httpd_req_recv(req,command+used,req->content_len-used);
        if (n<=0 || esp_timer_get_time()/1000-started>100)
            return httpd_resp_send_err(req,HTTPD_408_REQ_TIMEOUT,"Command expired");
        used+=(size_t)n;
    }
    // Exactly one printable ASCII command; HTTP body must not smuggle extra frames.
    for (size_t i=0;i<used;i++) if (command[i]<32 || command[i]>126)
        return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Invalid command framing");
    command[used]=0;
    if (!xSemaphoreTake(mutex,pdMS_TO_TICKS(10)))
        return unavailable(req);
    if (maintenance) { xSemaphoreGive(mutex); return unavailable(req); }
    int64_t now=esp_timer_get_time()/1000;
    bench_tick(&model,now);
    if (!strcmp(command,"GXR1 HELLO") && model.linked) {
        xSemaphoreGive(mutex);
        return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Session already leased");
    }
    for (size_t i=0;i<used;i++) bench_byte(&model,(unsigned char)command[i],now);
    bench_byte(&model,'\n',now);
    // Snapshot does not renew the lease or bypass the command rate check.
    bench_t snapshot=model; snapshot.pending=true; snapshot.reply_at=now-50;
    const bool ok=bench_reply(&snapshot,body,sizeof(body),now);
    xSemaphoreGive(mutex);
    if (!ok) return httpd_resp_send_err(req,HTTPD_500_INTERNAL_SERVER_ERROR,"Reply overflow");
    httpd_resp_set_type(req,"application/json");
    httpd_resp_set_hdr(req,"Cache-Control","no-store");
    httpd_resp_set_hdr(req,"X-Content-Type-Options","nosniff");
    return httpd_resp_sendstr(req,body);
}
