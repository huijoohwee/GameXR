// SPDX-License-Identifier: MIT
#include <assert.h>
#include <stdio.h>
#define DEVICE_TLS_AVAILABLE 1
#include "../main/wifi_bench.c"
int64_t test_ms=1000;
__asm__(".globl _binary_control_key_start\n_binary_control_key_start:\n.ascii \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"\n.globl _binary_control_key_end\n_binary_control_key_end:\n");
static const char *key="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
static httpd_req_t request(const char *body) { httpd_req_t r={.content_len=strlen(body),.host="192.168.4.1:8443",.origin="https://192.168.4.1:8443",.key=key,.body=body,.code=200};return r; }
int main(void) {
 assert(wifi_bench_init());
 httpd_req_t auth=request("");auth.origin=NULL;
 assert(device_authorized(&auth,false));assert(!device_authorized(&auth,true));
 auth.origin="https://evil.example";assert(!device_authorized(&auth,false));
 httpd_req_t r=request("GXR1 HELLO");r.key="wrong";wifi_bench_request(&r);assert(r.code==403 && !model.linked);
 r=request("GXR1 HELLO");r.host="192.168.4.1:8080";wifi_bench_request(&r);assert(r.code==403);
 r=request("GXR1 HELLO");r.origin="https://evil.example";wifi_bench_request(&r);assert(r.code==403);
 r=request("GXR1 HELLO\nGXR1 STOP");wifi_bench_request(&r);assert(r.code==400 && !model.linked);
 r=request("GXR1 HELLO");wifi_bench_request(&r);assert(r.code==200 && model.linked && strstr(r.response,"ready"));
 unsigned session=model.session;
 r=request("GXR1 HELLO");wifi_bench_request(&r);assert(r.code==400 && model.session==session);
 const float gyro[3]={0,0,0};test_ms+=100;wifi_bench_imu(true,gyro,test_ms);
 char line[96];snprintf(line,sizeof(line),"GXR1 SET %u 1 100 850 0 0",session);
 r=request(line);wifi_bench_request(&r);assert(r.code==200 && model.active && model.virtual_motors[0]>0);
 test_ms+=100;r=request(line);wifi_bench_request(&r);assert(!model.active && strstr(r.response,"sequence"));
 test_ms+=100;r=request("GXR1 HELLO");wifi_bench_request(&r);assert(model.linked);
 test_ms+=250;wifi_bench_tick(test_ms);assert(!model.linked && !model.active);
 for(int i=0;i<4;i++)assert(model.virtual_motors[i]==0);
 r=request("GXR1 STOP");wifi_bench_request(&r);assert(strstr(r.response,"stopped"));
 r=request("GXR1 HELLO");wifi_bench_request(&r);assert(model.linked);
 assert(wifi_bench_suspend(true));assert(!model.linked && !model.active);
 r=request("GXR1 HELLO");wifi_bench_request(&r);assert(!model.linked && r.code==503);
 assert(wifi_bench_suspend(false));r=request("GXR1 HELLO");wifi_bench_request(&r);assert(model.linked);
 puts("HTTPS handler auth/framing/lease/replay/STOP checks passed");
}
