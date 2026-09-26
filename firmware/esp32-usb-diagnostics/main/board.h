// SPDX-License-Identifier: MIT
#pragma once

// Captured firmware and supporting carrier schematic agree on these pins.
enum { MOTOR_FL = 14, MOTOR_FR = 15, MOTOR_RL = 12, MOTOR_RR = 13 };
enum { IMU_SCK = 18, IMU_MISO = 19, IMU_MOSI = 23, IMU_CS = 5 };
enum { BATTERY_GPIO = 36, BATTERY_ADC_CHANNEL = 0 };
// SBUS GPIO4/16 conflict is unresolved: neither pin is configured here.
#define TELEMETRY_PROFILE "gamexr.usb-diagnostics/v1"
#define HARDWARE_PROFILE "xw-z1-reference-esp32-mpu6500-v1"
