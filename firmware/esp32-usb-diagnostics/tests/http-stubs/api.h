#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
typedef int esp_err_t;
typedef void *SemaphoreHandle_t;
typedef struct { size_t content_len; const char *host,*origin,*key,*body; char response[512]; int code; } httpd_req_t;
#define ESP_OK 0
#define HTTPD_403_FORBIDDEN 403
#define HTTPD_400_BAD_REQUEST 400
#define HTTPD_408_REQ_TIMEOUT 408
#define HTTPD_500_INTERNAL_SERVER_ERROR 500
#define pdMS_TO_TICKS(n) (n)
extern int64_t test_ms;
static inline uint32_t esp_random(void) { return 42; }
static inline int64_t esp_timer_get_time(void) { return test_ms*1000; }
static inline SemaphoreHandle_t xSemaphoreCreateMutex(void) { return (void*)1; }
static inline int xSemaphoreTake(SemaphoreHandle_t m,int t) { (void)m;(void)t;return 1; }
static inline void xSemaphoreGive(SemaphoreHandle_t m) { (void)m; }
static inline const char *header(httpd_req_t *r,const char *n) { return !strcmp(n,"Host")?r->host:!strcmp(n,"Origin")?r->origin:r->key; }
static inline size_t httpd_req_get_hdr_value_len(httpd_req_t *r,const char *n) { const char *v=header(r,n);return v?strlen(v):0; }
static inline int httpd_req_get_hdr_value_str(httpd_req_t *r,const char *n,char *out,size_t cap) { const char *s=header(r,n);if(!s||strlen(s)>=cap)return -1;strcpy(out,s);return 0; }
static inline int httpd_req_recv(httpd_req_t *r,char *out,size_t n) { memcpy(out,r->body,n);return (int)n; }
static inline int httpd_resp_send_err(httpd_req_t *r,int code,const char *s) { r->code=code;strcpy(r->response,s);return 0; }
static inline int httpd_resp_set_status(httpd_req_t *r,const char *s) { r->code=atoi(s);return 0; }
static inline int httpd_resp_set_type(httpd_req_t *r,const char *s) { (void)r;(void)s;return 0; }
static inline int httpd_resp_set_hdr(httpd_req_t *r,const char *k,const char *v) { (void)r;(void)k;(void)v;return 0; }
static inline int httpd_resp_sendstr(httpd_req_t *r,const char *s) { strcpy(r->response,s);return 0; }
