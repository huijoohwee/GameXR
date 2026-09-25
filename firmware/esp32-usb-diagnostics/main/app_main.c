// SPDX-License-Identifier: MIT
#include <inttypes.h>
#include <stdio.h>
#include "board.h"
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
        // Do not initialize sensors or retry/reset out of this state.
        while (true) vTaskDelay(pdMS_TO_TICKS(1000));
    }
    uint8_t identity = 0;
    const imu_status_t imu_init = sensors_init_imu(&identity);
    const esp_err_t adc_init = sensors_init_battery();
    const esp_app_desc_t *app = esp_app_get_description();
    printf("{\"profile\":\"%s\",\"type\":\"boot\",\"hardware_profile\":\"%s\","
           "\"version\":\"%s\",\"idf\":\"%s\",\"motor_gate_command\":\"low_held\","
           "\"physical_isolation_verified\":false,\"imu_status\":\"%s\",\"who_am_i\":%u,\"adc_init_code\":%d}\n",
           TELEMETRY_PROFILE, HARDWARE_PROFILE, app->version, app->idf_ver,
           imu_status_name(imu_init), identity, (int)adc_init);
    uint32_t sequence = 0;
    TickType_t deadline = xTaskGetTickCount();
    while (true) {
        imu_sample_t imu = {0};
        const imu_status_t status = imu_init == IMU_OK ? sensors_read_imu(&imu) : imu_init;
        const battery_sample_t battery = sensors_read_battery();
        char line[640];
        if (format_sample(line, sizeof(line), sequence++, esp_timer_get_time()/1000, status, &imu, &battery))
            puts(line);
        else
            puts("{\"profile\":\"" TELEMETRY_PROFILE "\",\"type\":\"fatal\",\"error\":\"telemetry_overflow\"}");
        xTaskDelayUntil(&deadline, pdMS_TO_TICKS(100));
    }
}
