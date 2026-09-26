// SPDX-License-Identifier: MIT
#include "ota_guard.h"
#include "ota_policy.h"
#include "device_auth.h"
#include "wifi_bench.h"
#include "esp_app_desc.h"
#include "esp_ota_ops.h"
#include "esp_flash.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "psa/crypto.h"
#include <stdio.h>
#include <string.h>

static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static bool boot_verified, observed, ready, busy;
static ota_health_t health;
static esp_timer_handle_t restart_timer;
static void restart(void *arg) { (void)arg; esp_restart(); }
static bool region_matches(uint32_t offset, size_t length, const char *expected) {
    uint8_t want[32], actual[32], buffer[512];
    if(!ota_hex_digest(expected,want))return false;
    psa_hash_operation_t hash=PSA_HASH_OPERATION_INIT;size_t hash_size=0;
    int error=psa_hash_setup(&hash,PSA_ALG_SHA_256);
    for(size_t done=0;!error && done<length;done+=sizeof(buffer)) {
        size_t n=length-done < sizeof(buffer)?length-done:sizeof(buffer);
        if(esp_flash_read(NULL,buffer,offset+done,n)!=ESP_OK){error=-1;break;}
        error=psa_hash_update(&hash,buffer,n);
    }
    if(!error)error=psa_hash_finish(&hash,actual,sizeof(actual),&hash_size);
    psa_hash_abort(&hash);
    return !error && hash_size==32 && !memcmp(want,actual,32);
}
void ota_guard_init(void) {
    esp_ota_img_states_t state;
    health.pending=esp_ota_get_state_partition(esp_ota_get_running_partition(),&state)==ESP_OK
        && state==ESP_OTA_IMG_PENDING_VERIFY;
    boot_verified=psa_crypto_init()==PSA_SUCCESS && region_matches(0x1000,0x7000,OTA_BOOTLOADER_SHA256)
        && region_matches(0x8000,0x1000,OTA_PARTITIONS_SHA256);
    const esp_timer_create_args_t args={.callback=restart,.name="ota_restart"};
    if(esp_timer_create(&args,&restart_timer)!=ESP_OK) { boot_verified=false;if(health.pending)esp_restart(); }
    else if(health.pending && esp_timer_start_once(restart_timer,45000000)!=ESP_OK) { boot_verified=false;esp_restart(); }
}
void ota_guard_tick(bool healthy, bool network_ok, int64_t now) {
    portENTER_CRITICAL(&lock);
    const ota_health_action_t action=ota_health_step(&health,healthy,network_ok,boot_verified,observed,now);
    portEXIT_CRITICAL(&lock);
    if(action==OTA_HEALTH_CONFIRM) {
        // Establish a VALID predecessor even on the initial USB bootstrap.
        const bool ok=esp_ota_mark_app_valid_cancel_rollback()==ESP_OK;
        if(ok && health.pending) esp_timer_stop(restart_timer);
        portENTER_CRITICAL(&lock);ready=ok;health.failed=!ok;portEXIT_CRITICAL(&lock);
    } else if(action==OTA_HEALTH_ROLLBACK) {
        // The SDK only selects an available valid predecessor. Failure stays inhibited.
        esp_ota_mark_app_invalid_rollback_and_reboot();
    }
}
bool ota_guard_busy(void) { portENTER_CRITICAL(&lock);bool value=busy;portEXIT_CRITICAL(&lock);return value; }
bool ota_guard_acquire(void) {
    portENTER_CRITICAL(&lock);
    bool ok=ready && !busy;
    if(ok)busy=true;
    portEXIT_CRITICAL(&lock);
    if(ok && !wifi_bench_suspend(true)) {portENTER_CRITICAL(&lock);busy=false;portEXIT_CRITICAL(&lock);return false;}
    return ok;
}
void ota_guard_release(void) {
    wifi_bench_suspend(false);
    portENTER_CRITICAL(&lock);busy=false;portEXIT_CRITICAL(&lock);
}
esp_err_t ota_schedule_restart(void) { return esp_timer_start_once(restart_timer,1000000); }
static bool recovery_available(void) {
    const esp_partition_t *other=esp_ota_get_next_update_partition(NULL);
    esp_app_desc_t previous;
    return other && esp_ota_get_partition_description(other,&previous)==ESP_OK
        && !memcmp(previous.project_name,"gamexr_usb_diagnostics",22)
        && ota_version_supported(previous.version,sizeof(previous.version))
        && esp_ota_check_rollback_is_possible();
}
esp_err_t ota_status_request(httpd_req_t *req) {
    if(!device_authorized(req,false))return httpd_resp_send_err(req,HTTPD_403_FORBIDDEN,"Pairing required");
    portENTER_CRITICAL(&lock);observed=true;bool available=ready && !busy, active=busy, verified=health.verified && ready;portEXIT_CRITICAL(&lock);
    const esp_app_desc_t *app=esp_app_get_description();
    char elf[65], body[850];ota_hex_format(app->app_elf_sha256,elf);
    int n=snprintf(body,sizeof(body),"{\"schema\":\"gamexr.ota/v1\",\"version\":\"%s\",\"elf_sha256\":\"%s\","
        "\"ready\":%s,\"busy\":%s,\"bootloader_verified\":%s,\"boot_confirmed\":%s,"
        "\"rollback_available\":%s,\"max_bytes\":%u,\"bootloader_sha256\":\"%s\",\"partitions_sha256\":\"%s\",\"outputs_enabled\":false}",
        app->version,elf,available?"true":"false",active?"true":"false",boot_verified?"true":"false",
        verified?"true":"false",recovery_available()?"true":"false",OTA_IMAGE_LIMIT,OTA_BOOTLOADER_SHA256,OTA_PARTITIONS_SHA256);
    if(n<0 || (size_t)n>=sizeof(body))return httpd_resp_send_err(req,HTTPD_500_INTERNAL_SERVER_ERROR,"Status overflow");
    httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");
    return httpd_resp_send(req,body,n);
}
esp_err_t ota_recover_request(httpd_req_t *req) {
    if(!device_authorized(req,true))return httpd_resp_send_err(req,HTTPD_403_FORBIDDEN,"Pairing required");
    if(req->content_len!=0)return httpd_resp_send_err(req,HTTPD_400_BAD_REQUEST,"Empty recovery body required");
    if(!ota_guard_acquire()) {httpd_resp_set_status(req,"409 Conflict");return httpd_resp_sendstr(req,"Update unavailable");}
    if(!recovery_available() || esp_ota_mark_app_invalid_rollback()!=ESP_OK) {
        ota_guard_release();return httpd_resp_send_err(req,HTTPD_500_INTERNAL_SERVER_ERROR,"No verified recovery slot");
    }
    httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");
    const esp_err_t sent=httpd_resp_sendstr(req,"{\"schema\":\"gamexr.ota-result/v1\",\"status\":\"recovering\",\"outputs_enabled\":false}");
    if(ota_schedule_restart()!=ESP_OK)esp_restart();
    return sent;
}
