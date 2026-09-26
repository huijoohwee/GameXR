// SPDX-License-Identifier: MIT
#include "bench_uart.h"
#include "driver/uart.h"
#include "freertos/queue.h"
#include <stdio.h>
static QueueHandle_t events;
static bool ready;
esp_err_t bench_uart_init(void) {
    esp_err_t error = uart_driver_install(UART_NUM_0, 1024, 0, 16, &events, 0);
    ready = error == ESP_OK;
    return error;
}
void bench_uart_poll(bench_t *b, int64_t now) {
    bench_tick(b, now);
    if (!ready) return;
    uart_event_t event; bool damaged = false;
    for (int i = 0; i < 16 && xQueueReceive(events, &event, 0) == pdTRUE; i++)
        damaged |= event.type == UART_FIFO_OVF || event.type == UART_BUFFER_FULL
            || event.type == UART_FRAME_ERR || event.type == UART_PARITY_ERR || event.type == UART_BREAK;
    size_t buffered = 0;
    if (uart_get_buffered_data_len(UART_NUM_0, &buffered) != ESP_OK || buffered > 768) damaged = true;
    if (damaged) {
        bench_fault(b, "uart_fault"); b->used = 0; b->dropping = true;
        uart_flush_input(UART_NUM_0); xQueueReset(events);
    } else {
        unsigned char bytes[128];
        int count = uart_read_bytes(UART_NUM_0, bytes, sizeof(bytes), 0);
        if (count < 0) bench_fault(b, "uart_fault");
        for (int i = 0; i < count; i++) bench_byte(b, bytes[i], now);
    }
    char reply[384];
    if (bench_reply(b, reply, sizeof(reply), now)) puts(reply);
}
