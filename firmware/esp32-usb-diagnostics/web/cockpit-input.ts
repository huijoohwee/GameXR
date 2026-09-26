// SPDX-License-Identifier: MIT
import { axisRate, throttleTarget } from './control-profile.mjs';

/** Main cockpit input only; simulator state is never an aircraft command source. */
export class CockpitInput {
  mode: 'motion' | 'touch' = 'motion';
  active = false;
  throttle = 0;
  roll = 0;
  pitch = 0;
  clear() { this.throttle = this.roll = this.pitch = 0; }
  stop() { this.active = false; this.clear(); }
  select(mode: 'motion' | 'touch') {
    if (mode === this.mode) return false;
    this.stop(); this.mode = mode; return true;
  }
  setThrottle(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid throttle');
    this.throttle = this.active ? value : 0;
  }
  steer(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid joystick position');
    const scale = Math.max(1, Math.hypot(x, y));
    this.roll = this.active ? x / scale : 0;
    this.pitch = this.active ? -y / scale || 0 : 0;
  }
  axes(motion: { calibrated: boolean; phase: string; roll: number; pitch: number }, motionAge: number) {
    let { roll, pitch } = this;
    if (this.mode === 'motion') {
      if (!motion.calibrated || motion.phase !== 'running' || !Number.isFinite(motionAge) || motionAge >= 250 || motionAge < 0)
        throw new Error('Tap Enable Motion and hold steady, or touch the joystick to select Touch');
      ({ roll, pitch } = motion);
    }
    return [throttleTarget(this.throttle), axisRate(roll), axisRate(pitch), 0];
  }
}
