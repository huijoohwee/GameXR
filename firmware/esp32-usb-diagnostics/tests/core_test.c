// SPDX-License-Identifier: MIT
#include "mpu6500.h"
#include "telemetry.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

typedef struct { uint8_t registers[256]; int writes, fail_reg, corrupt_reg; } fake_t;
static int read_reg(void *context, uint8_t reg, uint8_t *out, size_t length)
{
    fake_t *f = context;
    if (f->fail_reg == reg) return -1;
    memcpy(out, f->registers + reg, length);
    if (f->corrupt_reg == reg) out[0] ^= 1;
    return 0;
}
static int write_reg(void *context, uint8_t reg, uint8_t value)
{
    fake_t *f = context;
    f->writes++;
    if (f->fail_reg == reg) return -1;
    f->registers[reg] = value;
    return 0;
}
static void delay_ms(unsigned ms) { assert(ms <= 100); }
static fake_t fresh(void)
{
    fake_t f = {.fail_reg=-1, .corrupt_reg=-1};
    f.registers[0x75] = 0x70;
    return f;
}

int main(void)
{
    fake_t f = fresh();
    imu_bus_t bus = {.read=read_reg, .write=write_reg, .delay_ms=delay_ms, .context=&f};
    uint8_t identity;
    f.registers[0x75] = 0x71;
    assert(mpu6500_init(&bus, &identity) == IMU_WRONG_ID && f.writes == 0);
    f = fresh(); f.fail_reg = 0x75;
    assert(mpu6500_init(&bus, &identity) == IMU_IO_ERROR && f.writes == 0);
    f = fresh(); f.corrupt_reg = 0x1c;
    assert(mpu6500_init(&bus, &identity) == IMU_CONFIG_ERROR);
    f = fresh();
    assert(mpu6500_init(&bus, &identity) == IMU_OK && identity == 0x70);
    imu_sample_t sample = {.accel={1,2,3}, .gyro={4,5,6}};
    assert(mpu6500_sample(&bus, &sample) == IMU_NOT_READY);
    for (int i=0; i<3; ++i) assert(sample.accel[i]==0 && sample.gyro[i]==0);
    f.registers[0x3a] = 1;
    const uint8_t burst[14] = {0x20,0, 0x80,0, 0x7f,0xff, 0,0, 0x19,0x96, 0xff,0xff, 0x80,0};
    memcpy(f.registers+0x3b, burst, sizeof(burst));
    assert(mpu6500_sample(&bus, &sample) == IMU_OK);
    assert(sample.accel[0]==8192 && sample.accel[1]==-32768 && sample.accel[2]==32767);
    assert(sample.gyro[0]==6550 && sample.gyro[1]==-1 && sample.gyro[2]==-32768);
    battery_sample_t battery = {.status=BAT_OK, .raw=2048, .adc_mv=2000};
    char line[640], tiny[8];
    assert(format_sample(line,sizeof(line),7,1234,IMU_OK,&sample,&battery));
    puts(line);
    assert(!format_sample(tiny,sizeof(tiny),7,1234,IMU_OK,&sample,&battery) && tiny[0]=='\0');
    assert(battery_mv_from_adc(2000)==2606);
    assert(battery_classify(2048,false,-1,false)==BAT_NO_CALIBRATION);
    assert(battery_classify(4095,true,3000,true)==BAT_OUT_OF_RANGE);
    assert(battery_classify(2000,true,2451,false)==BAT_OUT_OF_RANGE);
    assert(battery_classify(2000,true,149,false)==BAT_OUT_OF_RANGE);
    assert(battery_classify(2000,true,2450,false)==BAT_OK);
    assert(battery_classify(-1,true,2000,false)==BAT_IO_ERROR);
    f.fail_reg = 0x3b;
    assert(mpu6500_sample(&bus,&sample)==IMU_IO_ERROR && sample.accel[0]==0);
    battery.status=BAT_NO_CALIBRATION; battery.adc_mv=-1;
    assert(format_sample(line,sizeof(line),8,1334,IMU_IO_ERROR,&sample,&battery)); puts(line);
    battery.status=BAT_OUT_OF_RANGE; battery.raw=4095; battery.adc_mv=3100;
    assert(format_sample(line,sizeof(line),9,1434,IMU_NOT_READY,&sample,&battery)); puts(line);
    battery.status=BAT_IO_ERROR; battery.raw=-1; battery.adc_mv=-1;
    assert(format_sample(line,sizeof(line),10,1534,IMU_WRONG_ID,&sample,&battery)); puts(line);
    f = fresh(); f.registers[0x75]=0xff;
    assert(mpu6500_sample(&bus,&sample)==IMU_WRONG_ID);
    return 0;
}
