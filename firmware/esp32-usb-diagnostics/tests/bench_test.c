// SPDX-License-Identifier: MIT
#include "bench.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
static void line(bench_t *b, const char *s, int64_t now) {
    for (; *s; s++) bench_byte(b, (unsigned char)*s, now);
    bench_byte(b, '\n', now);
}
static void fresh(bench_t *b, int64_t now) { const float g[3] = {0}; bench_imu(b, true, g, now); }
static void ready(bench_t *b, int64_t now) { line(b, "GXR1 HELLO", now); fresh(b, now); assert(b->linked && !b->active); }
static void set(bench_t *b, uint32_t seq, const char *values, int64_t now) {
    char command[96]; snprintf(command, sizeof(command), "GXR1 SET %u %u %s", b->session, seq, values);
    line(b, command, now);
}
static void cleared(bench_t *b, const char *reason) {
    assert(!b->active && !b->linked && !strcmp(b->status, reason));
    for (int i=0; i<4; i++) assert(b->target[i]==0 && b->virtual_motors[i]==0);
}
int main(void) {
    bench_t b; bench_init(&b, 100); ready(&b, 0); set(&b, 1, "100 0 0 0", 60);
    assert(b.active); for(int i=0;i<4;i++) assert(b.virtual_motors[i]==100);
    fresh(&b,200); bench_tick(&b,309); assert(b.active);
    bench_tick(&b,310); cleared(&b,"expired");
    set(&b,2,"100 0 0 0",400); cleared(&b,"session");
    ready(&b,500); set(&b,2,"100 1000 0 0",560);
    assert(b.virtual_motors[0]==140 && b.virtual_motors[1]==60);
    assert(b.virtual_motors[2]==140 && b.virtual_motors[3]==60);
    set(&b,2,"100 0 0 0",620); cleared(&b,"sequence");
    ready(&b,700); set(&b,1,"201 0 0 0",760); cleared(&b,"range");
    ready(&b,800); set(&b,1,"100 1001 0 0",860); cleared(&b,"range");
    ready(&b,900); set(&b,1,"100 0 0 0 extra",960); cleared(&b,"malformed");
    ready(&b,1000); line(&b,"GXR1 SET 9999999999999999999999 1 100 0 0 0",1060); cleared(&b,"malformed");
    ready(&b,1100); set(&b,1,"100 0 0 0",1110); cleared(&b,"rate_limited");
    ready(&b,1200); set(&b,1,"100 0 0 0",1260);
    const float bad[3]={NAN,0,0}; bench_imu(&b,true,bad,1261); cleared(&b,"imu_invalid");
    ready(&b,1300); set(&b,1,"100 0 0 0",1360); bench_tick(&b,1500); cleared(&b,"imu_stale");
    ready(&b,1600); bench_byte(&b,'G',1660); bench_tick(&b,1760); cleared(&b,"partial_timeout");
    line(&b,"GXR1 HELLO",1800); assert(!b.linked); // drain partial line to newline
    ready(&b,1900); for(int i=0;i<100;i++) bench_byte(&b,'X',1960);
    cleared(&b,"framing"); bench_byte(&b,'\n',1960);
    ready(&b,2000); bench_byte(&b,0,2060); cleared(&b,"framing"); bench_byte(&b,'\n',2060);
    ready(&b,2100); set(&b,1,"100 0 0 0",2160); line(&b,"GXR1 STOP",2220); cleared(&b,"stopped");
    ready(&b,2300); set(&b,1,"0 1000 -1000 1000",2360);
    for(int i=0;i<4;i++) assert(b.virtual_motors[i]==0);
    ready(&b,2400); const float spinning[3]={1,-1,.5f}; bench_imu(&b,true,spinning,2410);
    set(&b,1,"100 0 0 0",2460);
    assert(b.virtual_motors[0]==0 && b.virtual_motors[1]==120);
    assert(b.virtual_motors[2]==120 && b.virtual_motors[3]==160);
    ready(&b,2500); set(&b,1,"200 1000 -1000 1000",2560);
    for(int i=0;i<4;i++) assert(b.virtual_motors[i]>=0 && b.virtual_motors[i]<=200);
    char reply[384]; assert(!bench_reply(&b,reply,4,2560)); assert(bench_reply(&b,reply,sizeof(reply),2560));
    puts(reply); assert(strstr(reply,"\"outputs_enabled\":false"));
    assert(strstr(reply,"\"motor_outputs\":[0,0,0,0]"));
    bench_fault(&b,"uart_fault"); cleared(&b,"uart_fault");
    uint32_t old=b.session; ready(&b,2700); assert(b.session!=old);
    char replay[96]; snprintf(replay,sizeof(replay),"GXR1 SET %u 100 100 0 0 0",old);
    line(&b,replay,2760); cleared(&b,"session");
    // Deterministic hostile byte stream under ASan/UBSan, always bounded outputs.
    uint32_t random=123;
    for(int i=0;i<100000;i++) {
        random=random*1664525u+1013904223u; bench_byte(&b,(unsigned char)(random>>24),3000+i);
        bench_tick(&b,3000+i);
        for(int j=0;j<4;j++) assert(b.virtual_motors[j]>=0 && b.virtual_motors[j]<=200);
    }
    return 0;
}
