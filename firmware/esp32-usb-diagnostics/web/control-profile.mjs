// SPDX-License-Identifier: MIT
// Numeric input-response facts only; no vendor flight implementation.
export const historical = Object.freeze({ expo: 0.40, deadzone: 0.06,
  stickScale: 0.85, yawScale: 0.68, throttleScale: 1, throttleDeadzone: 0.06 });
export function axisRate(input, yaw = false) {
  if (!Number.isFinite(input)) throw new Error('Invalid control input');
  const magnitude = Math.min(1, Math.abs(input));
  const curved = magnitude * (1 - historical.expo) + magnitude ** 3 * historical.expo;
  const normalized = Math.max(0, curved - historical.deadzone) / (1 - historical.deadzone);
  // New bench protocol: milliradians/second, maximum 1000. Not the historical angle target.
  return Math.round(Math.sign(input) * normalized * (yaw ? historical.yawScale : historical.stickScale) * 1000);
}
export function throttleTarget(input) {
  if (!Number.isFinite(input) || input < 0 || input > 1) throw new Error('Invalid throttle');
  return input < historical.throttleDeadzone ? 0 : Math.round(input * 200);
}
