// SPDX-License-Identifier: MIT
#include "ota_policy.h"
#include <string.h>
static int hex(char c) { return c >= '0' && c <= '9' ? c-'0' : c >= 'a' && c <= 'f' ? c-'a'+10 : -1; }
bool ota_hex_digest(const char *text, uint8_t out[32]) {
    if (strlen(text) != 64) return false;
    for (size_t i=0;i<32;i++) { int a=hex(text[i*2]),b=hex(text[i*2+1]); if(a<0||b<0)return false;out[i]=(a<<4)|b; }
    return true;
}
void ota_hex_format(const uint8_t bytes[32], char out[65]) {
    const char *digits="0123456789abcdef";
    for(size_t i=0;i<32;i++){out[i*2]=digits[bytes[i]>>4];out[i*2+1]=digits[bytes[i]&15];}out[64]=0;
}
bool ota_version_supported(const char *v, size_t cap) {
    if (!cap || !memchr(v,0,cap)) return false;
    unsigned values[3]={0};
    for (unsigned i=0;i<3;i++) {
        if(*v<'0'||*v>'9')return false;
        do { values[i]=values[i]*10+(unsigned)(*v++-'0'); if(values[i]>999)return false; } while(*v>='0'&&*v<='9');
        if(i<2 && *v++!='.')return false;
    }
    return !*v && (values[0]>0 || values[1]>4 || (values[1]==4 && values[2]>=6));
}
bool ota_image_prefix(const uint8_t *p, size_t n) {
    // ESP32 24-byte image header, 8-byte first segment header, 256-byte app descriptor.
    static const char project[]="gamexr_usb_diagnostics";
    if(n<288 || p[0]!=0xe9 || !p[1] || p[1]>16 || p[12] || p[13] || p[23]!=1
      || p[32]!=0x32 || p[33]!=0x54 || p[34]!=0xcd || p[35]!=0xab
      || memcmp(p+80,project,sizeof(project)) || !ota_version_supported((const char*)p+48,32))return false;
    return true;
}
ota_health_action_t ota_health_step(ota_health_t *h, bool healthy, bool network_ok,
                                  bool boot_verified, bool observed, int64_t now) {
    if(h->verified||h->failed)return OTA_HEALTH_WAIT;
    if(h->pending && now>=45000) {h->failed=true;return OTA_HEALTH_ROLLBACK;}
    h->healthy=healthy ? (h->healthy<50 ? h->healthy+1 : 50) : 0;
    if(boot_verified && network_ok && observed && h->healthy>=50) { h->verified=true;return OTA_HEALTH_CONFIRM; }
    return OTA_HEALTH_WAIT;
}
