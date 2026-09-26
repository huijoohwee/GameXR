// SPDX-License-Identifier: MIT
#include <inttypes.h>
#include <stdio.h>
#include "board.h"
#include "network.h"
#include "ota_guard.h"
#include "wifi_bench.h"
#include "bench_uart.h"
#include "esp_random.h"
#include "sensors.h"
#include "esp_app_desc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void app_main(void)
{
    // First application action; ROM/reset pin behavior still requires physical isolation.
    const esp_err_t motor_error = inhibit_motor_gates();
    setvbuf(stdout, NULL, _IONBF, 0);
    if (motor_error != ESP_OK) {
        printf("{\"profile\":\"%s\",\"type\":\"fatal\",\"error\":\"motor_inhibit_failed\",\"code\":%d}\n",
               TELEMETRY_PROFILE, (int)motor_error);
        // Pending OTA receives a bounded reboot so the bootloader can recover.
        ota_guard_init();
        // Do not initialize sensors or retry motor setup in this state.
        while (true) vTaskDelay(pdMS_TO_TICKS(1000));
    }
    ota_guard_init();
    uint8_t identity = 0;
    const imu_status_t imu_init = sensors_init_imu(&identity);
    const esp_err_t adc_init = sensors_init_battery();
    const esp_app_desc_t *app = esp_app_get_description();
    printf("{\"profile\":\"%s\",\"type\":\"boot\",\"hardware_profile\":\"%s\","
           "\"version\":\"%s\",\"idf\":\"%s\",\"motor_gate_command\":\"low_held\","
           "\"physical_isolation_verified\":false,\"imu_status\":\"%s\",\"who_am_i\":%u,\"adc_init_code\":%d}\n",
           TELEMETRY_PROFILE, HARDWARE_PROFILE, app->version, app->idf_ver,
           imu_status_name(imu_init), identity, (int)adc_init);
    const esp_err_t network_error = network_start();
    if (network_error != ESP_OK) printf("{\"profile\":\"gamexr.direct-wifi/v1\",\"type\":\"network_error\",\"code\":%d}\n", (int)network_error);
    bench_t bench; bench_init(&bench, esp_random());
    const esp_err_t uart_error = bench_uart_init();
    printf("{\"profile\":\"gamexr.usb-bench/v1\",\"type\":\"ready\",\"version\":\"%s\",\"uart_code\":%d,\"outputs_enabled\":false}\n", app->version, (int)uart_error);
    uint32_t sequence = 0;
    int64_t next_sample = 0;
    TickType_t deadline = xTaskGetTickCount();
    while (true) {
        const int64_t now = esp_timer_get_time()/1000;
        if (!ota_guard_busy()) bench_uart_poll(&bench, now);
        wifi_bench_tick(now);
        if (now < next_sample) { xTaskDelayUntil(&deadline, pdMS_TO_TICKS(10)); continue; }
        next_sample = now + 100;
        imu_sample_t imu = {0};
        const imu_status_t status = imu_init == IMU_OK ? sensors_read_imu(&imu) : imu_init;
        const float gyro[] = {gyro_radians_per_second(imu.gyro[0]),
            gyro_radians_per_second(imu.gyro[1]), gyro_radians_per_second(imu.gyro[2])};
        bench_imu(&bench, status == IMU_OK, gyro, now);
        wifi_bench_imu(status == IMU_OK, gyro, now);
        ota_guard_tick(status == IMU_OK, network_error == ESP_OK, now);
        const battery_sample_t battery = sensors_read_battery();
        char line[640];
        const int64_t sampled_ms = esp_timer_get_time()/1000;
        if (format_sample(line, sizeof(line), sequence++, sampled_ms, status, &imu, &battery)) {
            network_publish(line, sequence - 1, sampled_ms); puts(line);
        }
        else
            puts("{\"profile\":\"" TELEMETRY_PROFILE "\",\"type\":\"fatal\",\"error\":\"telemetry_overflow\"}");
        xTaskDelayUntil(&deadline, pdMS_TO_TICKS(10));
    }
}
