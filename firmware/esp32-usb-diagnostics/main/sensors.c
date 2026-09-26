// SPDX-License-Identifier: MIT
#include "sensors.h"
#include "board.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>

static spi_device_handle_t spi;
static adc_oneshot_unit_handle_t adc;
static adc_cali_handle_t calibration;
static bool adc_ready;

esp_err_t inhibit_motor_gates(void)
{
    const gpio_num_t pins[] = {MOTOR_FL, MOTOR_FR, MOTOR_RL, MOTOR_RR};
    esp_err_t first_error = ESP_OK;
    // Attempt every gate even if one API reports an error. Never set a high level.
    for (unsigned i = 0; i < sizeof(pins) / sizeof(pins[0]); ++i) {
        esp_err_t err = gpio_set_level(pins[i], 0); // latch zero before output-enable
        if (err != ESP_OK && first_error == ESP_OK) first_error = err;
        gpio_config_t config = {.pin_bit_mask = 1ULL << pins[i], .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE, .pull_down_en = GPIO_PULLDOWN_ENABLE,
            .intr_type = GPIO_INTR_DISABLE};
        err = gpio_config(&config);
        if (err != ESP_OK && first_error == ESP_OK) first_error = err;
        err = gpio_set_level(pins[i], 0);
        if (err != ESP_OK && first_error == ESP_OK) first_error = err;
        // Latch output configuration until reset. No hold-release path exists here.
        err = gpio_hold_en(pins[i]);
        if (err != ESP_OK && first_error == ESP_OK) first_error = err;
    }
    return first_error;
}

static int spi_read(void *context, uint8_t reg, uint8_t *out, size_t length)
{
    (void)context;
    if (!spi || length > 14) return -1;
    uint8_t tx[15] = {0}, rx[15] = {0};
    tx[0] = reg | 0x80;
    spi_transaction_t transaction = {.length = (length + 1) * 8, .tx_buffer = tx, .rx_buffer = rx};
    esp_err_t err = spi_device_transmit(spi, &transaction);
    if (err == ESP_OK) memcpy(out, rx + 1, length);
    return err;
}

static int spi_write(void *context, uint8_t reg, uint8_t value)
{
    (void)context;
    uint8_t data[2] = {reg & 0x7f, value};
    spi_transaction_t transaction = {.length = 16, .tx_buffer = data};
    return spi_device_transmit(spi, &transaction);
}

static void delay_ms(unsigned ms) { vTaskDelay(pdMS_TO_TICKS(ms)); }
static const imu_bus_t bus = {.read = spi_read, .write = spi_write, .delay_ms = delay_ms};

imu_status_t sensors_init_imu(uint8_t *identity)
{
    *identity = 0;
    spi_bus_config_t config = {.mosi_io_num = IMU_MOSI, .miso_io_num = IMU_MISO,
        .sclk_io_num = IMU_SCK, .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = 15};
    if (spi_bus_initialize(SPI3_HOST, &config, SPI_DMA_DISABLED) != ESP_OK) return IMU_IO_ERROR;
    spi_device_interface_config_t device = {.clock_speed_hz = 1000000, .mode = 0,
        .spics_io_num = IMU_CS, .queue_size = 1};
    if (spi_bus_add_device(SPI3_HOST, &device, &spi) != ESP_OK) return IMU_IO_ERROR;
    return mpu6500_init(&bus, identity);
}

imu_status_t sensors_read_imu(imu_sample_t *out) { return mpu6500_sample(&bus, out); }

esp_err_t sensors_init_battery(void)
{
    adc_oneshot_unit_init_cfg_t unit = {.unit_id = ADC_UNIT_1};
    esp_err_t err = adc_oneshot_new_unit(&unit, &adc);
    if (err != ESP_OK) return err;
    adc_oneshot_chan_cfg_t channel = {.atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12};
    err = adc_oneshot_config_channel(adc, BATTERY_ADC_CHANNEL, &channel);
    if (err != ESP_OK) return err;
    adc_ready = true;
    adc_cali_line_fitting_efuse_val_t efuse;
    // No guessed Vref fallback: missing calibration means raw-only telemetry.
    if (adc_cali_scheme_line_fitting_check_efuse(&efuse) != ESP_OK ||
        efuse == ADC_CALI_LINE_FITTING_EFUSE_VAL_DEFAULT_VREF) return ESP_OK;
    adc_cali_line_fitting_config_t config = {.unit_id = ADC_UNIT_1,
        .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12, .default_vref = 0};
    return adc_cali_create_scheme_line_fitting(&config, &calibration);
}

battery_sample_t sensors_read_battery(void)
{
    battery_sample_t out = {.status = BAT_IO_ERROR, .raw = -1, .adc_mv = -1};
    if (!adc_ready) return out;
    int total = 0, mv_total = 0;
    bool saturated = false;
    for (int i = 0; i < 16; ++i) {
        int raw = 0, mv = 0;
        if (adc_oneshot_read(adc, BATTERY_ADC_CHANNEL, &raw) != ESP_OK) return out;
        saturated |= raw >= 4095;
        total += raw;
        if (calibration) {
            if (adc_cali_raw_to_voltage(calibration, raw, &mv) != ESP_OK) return out;
            mv_total += mv;
        }
    }
    out.raw = (total + 8) / 16;
    if (calibration) out.adc_mv = (mv_total + 8) / 16;
    out.status = battery_classify(out.raw, calibration != NULL, out.adc_mv, saturated);
    return out;
}
