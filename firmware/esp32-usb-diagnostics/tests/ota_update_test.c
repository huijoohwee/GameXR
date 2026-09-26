// SPDX-License-Identifier: MIT
#include <assert.h>
#include "ota_sdk.h"
#include "ota_policy.h"
bool test_ready,test_busy,fail_begin,fail_write,fail_end,fail_select,fail_read,corrupt_read;
size_t cutoff;
int begun,written,ended,aborted,selected,restarted;
int64_t test_ms;
unsigned char flash_bytes[2048], image[1024];
esp_partition_t running={0x10000,OTA_IMAGE_LIMIT,0,16},inactive={0x150000,OTA_IMAGE_LIMIT,0,17},boot;
bool device_authorized(httpd_req_t *r,bool origin){(void)origin;return r->authorized;}
bool ota_guard_acquire(void){if(!test_ready||test_busy)return false;test_busy=true;return true;}
void ota_guard_release(void){test_busy=false;}
esp_err_t ota_schedule_restart(void){restarted++;return 0;}
#include "../main/ota_update.c"
static char digest[65];
static httpd_req_t reset(void){
    test_ready=true;test_busy=fail_begin=fail_write=fail_end=fail_select=fail_read=corrupt_read=false;
    begun=written=ended=aborted=selected=restarted=0;cutoff=sizeof(image);test_ms=1000;boot=running;
    memset(image,0,sizeof(image));image[0]=0xe9;image[1]=6;image[23]=1;
    image[32]=0x32;image[33]=0x54;image[34]=0xcd;image[35]=0xab;
    strcpy((char*)image+48,"0.4.6");strcpy((char*)image+80,"gamexr_usb_diagnostics");
    psa_hash_operation_t h;uint8_t bytes[32];size_t n;psa_hash_setup(&h,PSA_ALG_SHA_256);psa_hash_update(&h,image,sizeof(image));psa_hash_finish(&h,bytes,sizeof(bytes),&n);ota_hex_format(bytes,digest);
    return (httpd_req_t){.content_len=sizeof(image),.body=image,.code=200,.authorized=true,.digest=digest,
        .bootstrap=OTA_BOOTLOADER_SHA256,.partitions=OTA_PARTITIONS_SHA256,.content_type="application/octet-stream"};
}
int main(void){
    httpd_req_t r=reset();r.authorized=false;ota_upload_request(&r);assert(r.code==403&&!begun);
    r=reset();r.content_len=OTA_IMAGE_LIMIT+1;ota_upload_request(&r);assert(r.code==400&&!begun);
    r=reset();r.digest="bad";ota_upload_request(&r);assert(r.code==400&&!begun);
    r=reset();r.bootstrap="other";ota_upload_request(&r);assert(r.code==400&&!begun);
    r=reset();test_ready=false;ota_upload_request(&r);assert(r.code==409&&!begun);
    r=reset();test_busy=true;ota_upload_request(&r);assert(r.code==409&&!begun);
    r=reset();boot.address=inactive.address;ota_upload_request(&r);assert(!begun&&!test_busy);
    r=reset();image[12]=9;ota_upload_request(&r);assert(!begun&&!selected);
    r=reset();strcpy((char*)image+48,"0.4.4");ota_upload_request(&r);assert(!begun&&!selected);
    r=reset();cutoff=100;ota_upload_request(&r);assert(!begun&&!selected);
    r=reset();cutoff=400;ota_upload_request(&r);assert(begun&&aborted&&!selected&&!test_busy);
    r=reset();fail_begin=true;ota_upload_request(&r);assert(begun&&aborted&&!selected);
    r=reset();fail_write=true;ota_upload_request(&r);assert(aborted&&!ended&&!selected);
    r=reset();image[900]^=1;ota_upload_request(&r);assert(aborted&&!ended&&!selected);
    r=reset();fail_end=true;ota_upload_request(&r);assert(ended&&!aborted&&!selected);
    r=reset();fail_read=true;ota_upload_request(&r);assert(ended&&!selected);
    r=reset();corrupt_read=true;ota_upload_request(&r);assert(ended&&!selected);
    r=reset();fail_select=true;ota_upload_request(&r);assert(ended&&!selected&&!restarted);
    r=reset();ota_upload_request(&r);assert(r.code==200&&selected==1&&restarted==1&&ended==1&&!aborted&&test_busy);
    assert(strstr(r.response,"restarting")&&strstr(r.response,digest));
    ota_health_t health={.pending=true};
    for(int i=0;i<49;i++)assert(ota_health_step(&health,true,true,true,true,i*100)==OTA_HEALTH_WAIT);
    assert(ota_health_step(&health,true,true,true,true,5000)==OTA_HEALTH_CONFIRM);
    health=(ota_health_t){.pending=true};
    assert(ota_health_step(&health,false,true,true,true,45000)==OTA_HEALTH_ROLLBACK);
    health=(ota_health_t){.pending=true};
    for(int i=0;i<60;i++)assert(ota_health_step(&health,true,true,false,true,i*100)==OTA_HEALTH_WAIT);
    assert(ota_health_step(&health,true,true,false,true,45000)==OTA_HEALTH_ROLLBACK);
    health=(ota_health_t){0};assert(ota_health_step(&health,true,true,true,false,50000)==OTA_HEALTH_WAIT);
    for(int i=0;i<49;i++)ota_health_step(&health,true,true,true,false,50100+i*100);
    assert(ota_health_step(&health,true,true,true,true,60000)==OTA_HEALTH_CONFIRM);
}
