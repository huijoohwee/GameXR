// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef int esp_err_t;
typedef int httpd_err_code_t;
typedef unsigned esp_ota_handle_t;
typedef struct { unsigned address, size, type, subtype; } esp_partition_t;
typedef struct { size_t content_len, received; const char *digest,*bootstrap,*partitions,*content_type; bool authorized;
    const unsigned char *body; int code; char response[900]; } httpd_req_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define HTTPD_403_FORBIDDEN 403
#define HTTPD_400_BAD_REQUEST 400
#define HTTPD_500_INTERNAL_SERVER_ERROR 500
#define ESP_PARTITION_TYPE_APP 0
#define ESP_PARTITION_SUBTYPE_APP_OTA_0 16
#define ESP_PARTITION_SUBTYPE_APP_OTA_1 17
extern bool test_ready, test_busy, fail_begin, fail_write, fail_end, fail_select, fail_read, corrupt_read;
extern size_t cutoff;
extern int begun, written, ended, aborted, selected, restarted;
extern int64_t test_ms;
extern unsigned char flash_bytes[2048];
extern esp_partition_t running, inactive, boot;
typedef struct { uint8_t value[32]; size_t offset; } psa_hash_operation_t;
#define PSA_HASH_OPERATION_INIT {0}
#define PSA_ALG_SHA_256 1
#define PSA_SUCCESS 0
static inline int psa_crypto_init(void){return 0;}
static inline int psa_hash_setup(psa_hash_operation_t *h,int mode){(void)mode;memset(h,0,sizeof(*h));return 0;}
// Deterministic double tests call ordering and failure branches; not the SHA primitive.
static inline int psa_hash_update(psa_hash_operation_t *h,const void *data,size_t n){const uint8_t *p=data;for(size_t i=0;i<n;i++)h->value[(h->offset++)%32]^=p[i];return 0;}
static inline int psa_hash_finish(psa_hash_operation_t *h,uint8_t *out,size_t cap,size_t *n){(void)cap;memcpy(out,h->value,32);*n=32;return 0;}
static inline int psa_hash_abort(psa_hash_operation_t *h){(void)h;return 0;}
static inline int64_t esp_timer_get_time(void){return test_ms*1000;}
static inline int httpd_req_get_hdr_value_str(httpd_req_t *r,const char *key,char *out,size_t cap){
    const char *value=!strcmp(key,"Content-Type")?r->content_type:!strcmp(key,"X-GXR-SHA256")?r->digest:!strcmp(key,"X-GXR-Bootloader")?r->bootstrap:r->partitions;
    if(!value||strlen(value)>=cap)return -1;strcpy(out,value);return 0;
}
static inline int httpd_req_recv(httpd_req_t *r,char *out,size_t n){if(r->received>=cutoff)return -1;if(n>cutoff-r->received)n=cutoff-r->received;memcpy(out,r->body+r->received,n);r->received+=n;return (int)n;}
static inline int httpd_resp_send_err(httpd_req_t *r,int code,const char *msg){r->code=code;strcpy(r->response,msg);return 0;}
static inline int httpd_resp_sendstr(httpd_req_t *r,const char *msg){strcpy(r->response,msg);return 0;}
static inline int httpd_resp_set_status(httpd_req_t *r,const char *msg){(void)msg;r->code=409;return 0;}
static inline int httpd_resp_set_type(httpd_req_t *r,const char *msg){(void)r;(void)msg;return 0;}
static inline int httpd_resp_set_hdr(httpd_req_t *r,const char *k,const char *v){(void)r;(void)k;(void)v;return 0;}
static inline const esp_partition_t *esp_ota_get_running_partition(void){return &running;}
static inline const esp_partition_t *esp_ota_get_next_update_partition(const esp_partition_t *p){(void)p;return &inactive;}
static inline const esp_partition_t *esp_ota_get_boot_partition(void){return &boot;}
static inline int esp_ota_begin(const esp_partition_t *p,size_t n,esp_ota_handle_t *h){(void)p;(void)n;begun++;*h=1;return fail_begin?-1:0;}
static inline int esp_ota_write(esp_ota_handle_t h,const void *p,size_t n){(void)h;if(fail_write)return -1;memcpy(flash_bytes+written,p,n);written+=(int)n;return 0;}
static inline int esp_ota_end(esp_ota_handle_t h){(void)h;ended++;return fail_end?-1:0;}
static inline int esp_ota_abort(esp_ota_handle_t h){(void)h;aborted++;return 0;}
static inline int esp_partition_read(const esp_partition_t *p,size_t off,void *out,size_t n){(void)p;if(fail_read)return -1;memcpy(out,flash_bytes+off,n);if(corrupt_read)((char*)out)[0]^=1;return 0;}
static inline int esp_ota_set_boot_partition(const esp_partition_t *p){(void)p;if(fail_select)return -1;selected++;return 0;}
static inline void esp_restart(void){restarted++;}
