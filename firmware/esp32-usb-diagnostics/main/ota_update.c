// SPDX-License-Identifier: MIT
#include "ota_guard.h"
#include "ota_policy.h"
#include "device_auth.h"
#include "esp_ota_ops.h"
#include "esp_app_desc.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "psa/crypto.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static esp_err_t reject(httpd_req_t *req,httpd_err_code_t code,const char *reason) {
    httpd_resp_set_hdr(req,"Connection","close");httpd_resp_send_err(req,code,reason);return ESP_FAIL;
}
esp_err_t ota_upload_request(httpd_req_t *req) {
    if(!device_authorized(req,true))return reject(req,HTTPD_403_FORBIDDEN,"Pairing required");
    char digest[65], type[40], bootstrap[65], partitions[65];uint8_t expected[32];
    if(req->content_len<OTA_IMAGE_MIN || req->content_len>OTA_IMAGE_LIMIT
        || httpd_req_get_hdr_value_str(req,"Content-Type",type,sizeof(type))!=ESP_OK || strcmp(type,"application/octet-stream")
        || httpd_req_get_hdr_value_str(req,"X-GXR-SHA256",digest,sizeof(digest))!=ESP_OK || !ota_hex_digest(digest,expected))
        return reject(req,HTTPD_400_BAD_REQUEST,"Exact application size, type and SHA-256 required");
    if(httpd_req_get_hdr_value_str(req,"X-GXR-Bootloader",bootstrap,sizeof(bootstrap))!=ESP_OK || strcmp(bootstrap,OTA_BOOTLOADER_SHA256)
        || httpd_req_get_hdr_value_str(req,"X-GXR-Partitions",partitions,sizeof(partitions))!=ESP_OK || strcmp(partitions,OTA_PARTITIONS_SHA256))
        return reject(req,HTTPD_400_BAD_REQUEST,"Package recovery layout mismatch");
    if(!ota_guard_acquire()) {httpd_resp_set_status(req,"409 Conflict");httpd_resp_set_hdr(req,"Connection","close");httpd_resp_sendstr(req,"OTA busy or bootstrap/health verification pending");return ESP_FAIL;}
    const esp_partition_t *running=esp_ota_get_running_partition(),*next=esp_ota_get_next_update_partition(NULL);
    const esp_partition_t *boot=esp_ota_get_boot_partition();
    esp_ota_handle_t handle=0; bool opened=false; size_t used=0;
    uint8_t *buffer=NULL;const char *reason="Invalid inactive application slot";int code=HTTPD_400_BAD_REQUEST;
    psa_hash_operation_t hash=PSA_HASH_OPERATION_INIT;size_t hash_size=0;
    if(!running || !next || !boot || boot->address!=running->address || next->address==running->address
        || next->type!=ESP_PARTITION_TYPE_APP || (next->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_0 && next->subtype!=ESP_PARTITION_SUBTYPE_APP_OTA_1)
        || (next->address!=0x10000 && next->address!=0x150000) || next->size!=OTA_IMAGE_LIMIT)goto failed;
    buffer=malloc(4096);if(!buffer){reason="Upload memory unavailable";code=HTTPD_500_INTERNAL_SERVER_ERROR;goto failed;}
    if(psa_hash_setup(&hash,PSA_ALG_SHA_256)){reason="Hash setup failed";goto failed;}
    const int64_t started=esp_timer_get_time()/1000;
    // Read and validate the prefix before erasing any inactive bytes.
    while(used<288) {
        int n=httpd_req_recv(req,(char*)buffer+used,288-used);
        if(n<=0 || esp_timer_get_time()/1000-started>=OTA_UPLOAD_MS){reason="Upload interrupted before image header";goto failed;}
        used+=(size_t)n;
    }
    if(!ota_image_prefix(buffer,used)){reason="Expected ESP32 GameXR OTA-capable application (0.4.6+)";goto failed;}
    const esp_err_t begun=esp_ota_begin(next,req->content_len,&handle);opened=handle!=0;
    if(begun!=ESP_OK){reason="OTA begin failed";goto failed;}
    if(esp_ota_write(handle,buffer,used)!=ESP_OK || psa_hash_update(&hash,buffer,used)){reason="Flash write failed";goto failed;}
    while(used<req->content_len) {
        size_t want=req->content_len-used;if(want>4096)want=4096;
        int n=httpd_req_recv(req,(char*)buffer,want);
        if(n<=0 || esp_timer_get_time()/1000-started>=OTA_UPLOAD_MS){reason="Upload interrupted; current application retained";goto failed;}
        if(esp_ota_write(handle,buffer,n)!=ESP_OK || psa_hash_update(&hash,buffer,n)){reason="Flash write failed";goto failed;}
        used+=(size_t)n;
    }
    uint8_t actual[32];
    if(psa_hash_finish(&hash,actual,sizeof(actual),&hash_size) || hash_size!=32 || memcmp(actual,expected,32)){reason="Uploaded SHA-256 mismatch";goto failed;}
    const esp_err_t ended=esp_ota_end(handle);opened=false; // SDK frees the handle on success AND failure.
    if(ended!=ESP_OK){reason="ESP32 image verification failed";goto failed;}
    // Independently hash exact written flash bytes before changing the boot selection.
    if(psa_hash_setup(&hash,PSA_ALG_SHA_256)){reason="Readback hash setup failed";goto failed;}
    for(size_t offset=0;offset<used;offset+=4096) {
        size_t n=used-offset;if(n>4096)n=4096;
        if(esp_timer_get_time()/1000-started>=OTA_UPLOAD_MS || esp_partition_read(next,offset,buffer,n)!=ESP_OK || psa_hash_update(&hash,buffer,n)){reason="Flash readback failed";goto failed;}
    }
    if(psa_hash_finish(&hash,actual,sizeof(actual),&hash_size) || hash_size!=32 || memcmp(actual,expected,32)){reason="Flash SHA-256 mismatch";goto failed;}
    if(esp_ota_set_boot_partition(next)!=ESP_OK){reason="Boot selection failed; inspect device status";goto failed;}
    free(buffer);psa_hash_abort(&hash);
    char reply[220];snprintf(reply,sizeof(reply),"{\"schema\":\"gamexr.ota-result/v1\",\"status\":\"restarting\",\"sha256\":\"%s\",\"outputs_enabled\":false}",digest);
    httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");
    const esp_err_t sent=httpd_resp_sendstr(req,reply);
    if(ota_schedule_restart()!=ESP_OK)esp_restart();
    return sent;
failed:
    if(opened)esp_ota_abort(handle);
    free(buffer);psa_hash_abort(&hash);ota_guard_release();
    // Closing avoids treating unread binary bytes as a subsequent keep-alive request.
    httpd_resp_set_hdr(req,"Connection","close");
    httpd_resp_send_err(req,code,reason);
    return ESP_FAIL;
}
