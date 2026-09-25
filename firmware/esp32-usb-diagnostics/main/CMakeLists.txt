idf_component_register(SRCS "app_main.c" "sensors.c" "mpu6500.c" "telemetry.c"
    INCLUDE_DIRS "."
    REQUIRES esp_driver_gpio esp_driver_spi esp_adc esp_timer esp_app_format)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
