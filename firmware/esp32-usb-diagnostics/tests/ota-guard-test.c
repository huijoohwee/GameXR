// SPDX-License-Identifier: MIT
// Executes the production boot guard against explicit SDK fault doubles.
#include "ota_sdk.h"
#include <assert.h>
#include <stdio.h>
bool test_ready,test_busy,fail_begin,fail_write,fail_end,fail_select,fail_read,corrupt_read;
size_t cutoff; int begun,written,ended,aborted,selected,restarted;int64_t test_ms;
unsigned char flash_bytes[2048];esp_partition_t running,inactive,boot;
typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(m) ((void)(m))
#define portEXIT_CRITICAL(m) ((void)(m))
typedef int esp_ota_img_states_t;
#define ESP_OTA_IMG_PENDING_VERIFY 1
static int state, confirmed, rollback, suspended;
static bool bad_boot,timer_fails,timer_start_fails,confirm_fails,other_valid,rollback_fails;
typedef struct { char project_name[32],version[32];uint8_t app_elf_sha256[32]; } esp_app_desc_t;
static esp_app_desc_t descriptor, previous;
typedef void *esp_timer_handle_t;
typedef struct { void (*callback)(void*);const char *name; } esp_timer_create_args_t;
static int64_t timer_us;static void (*timer_callback)(void*);
static int esp_timer_create(const esp_timer_create_args_t *a,esp_timer_handle_t *out){timer_callback=a->callback;*out=(void*)1;return timer_fails?-1:0;}
static int esp_timer_start_once(esp_timer_handle_t h,uint64_t delay){(void)h;timer_us=delay;return timer_start_fails?-1:0;}
static int esp_timer_stop(esp_timer_handle_t h){(void)h;timer_us=0;return 0;}
static int esp_flash_read(void *chip,void *data,uint32_t off,size_t n){(void)chip;(void)off;memset(data,0,n);return bad_boot?-1:0;}
static int esp_ota_get_state_partition(const esp_partition_t *p,int *out){(void)p;*out=state;return 0;}
static int esp_ota_mark_app_valid_cancel_rollback(void){confirmed++;return confirm_fails?-1:0;}
static int esp_ota_mark_app_invalid_rollback_and_reboot(void){rollback++;return -1;}
static int esp_ota_mark_app_invalid_rollback(void){rollback++;return rollback_fails?-1:0;}
static bool esp_ota_check_rollback_is_possible(void){return other_valid;}
static int esp_ota_get_partition_description(const esp_partition_t *p,esp_app_desc_t *out){(void)p;*out=previous;return 0;}
static const esp_app_desc_t *esp_app_get_description(void){return &descriptor;}
static int httpd_resp_send(httpd_req_t *r,const char *body,int n){assert(n<(int)sizeof(r->response));memcpy(r->response,body,n);r->response[n]=0;return 0;}
#include "../main/ota_guard.c"
bool device_authorized(httpd_req_t *r,bool origin){(void)origin;return r->authorized;}
bool wifi_bench_suspend(bool value){suspended=value;return true;}
static void reset(bool pending){
 boot_verified=observed=ready=busy=false;memset(&health,0,sizeof(health));
 bad_boot=timer_fails=timer_start_fails=confirm_fails=rollback_fails=false;other_valid=true;
 confirmed=rollback=suspended=restarted=0;timer_us=0;state=pending?ESP_OTA_IMG_PENDING_VERIFY:0;
 strcpy(descriptor.version,"0.4.6");strcpy(previous.version,"0.4.6");strcpy(previous.project_name,"gamexr_usb_diagnostics");
}
static void samples(void){for(int i=1;i<=50;i++)ota_guard_tick(true,true,i*100);}
static httpd_req_t req(void){httpd_req_t r={.authorized=true,.code=200};return r;}
int main(void){
 reset(true);ota_guard_init();assert(boot_verified && timer_us==45000000);samples();assert(!ready);
 httpd_req_t r=req();r.authorized=false;ota_status_request(&r);assert(r.code==403 && !observed);
 r=req();ota_status_request(&r);assert(observed);ota_guard_tick(true,true,5100);assert(ready && confirmed==1 && timer_us==0);
 assert(ota_guard_acquire());assert(busy && suspended && !ota_guard_acquire());ota_guard_release();assert(!busy && !suspended);
 reset(true);bad_boot=true;ota_guard_init();samples();assert(!ready);ota_guard_tick(true,true,45000);assert(rollback==1 && !ready);
 reset(true);ota_guard_init();timer_callback(NULL);assert(restarted==1); // startup-stall timer resets for bootloader rollback
 reset(true);ota_guard_init();observed=true;confirm_fails=true;samples();assert(!ready && timer_us==45000000);
 reset(false);ota_guard_init();samples();ota_guard_tick(true,true,60000);assert(!ready);observed=true;ota_guard_tick(true,true,60100);assert(ready && confirmed==1);
 r=req();r.content_len=1;ota_recover_request(&r);assert(r.code==400 && rollback==0);
 r=req();strcpy(previous.version,"0.4.4");ota_recover_request(&r);assert(r.code==500 && !busy && rollback==0);
 strcpy(previous.version,"0.4.6");r=req();ota_recover_request(&r);assert(rollback==1 && busy && suspended && timer_us==1000000);
 reset(false);timer_fails=true;ota_guard_init();observed=true;samples();assert(!ready);
 reset(true);timer_fails=true;ota_guard_init();assert(restarted==1 && !boot_verified);
 reset(true);timer_start_fails=true;ota_guard_init();assert(restarted==1 && !boot_verified);
 puts("Boot guard, authenticated confirmation, timer fallback and compatible recovery tests passed");
}
