export const historical: Readonly<{ expo: number; deadzone: number; stickScale: number;
  yawScale: number; throttleScale: number; throttleDeadzone: number }>;
export function axisRate(input: number, yaw?: boolean): number;
export function throttleTarget(input: number): number;
